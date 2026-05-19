import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { sources, collectedData } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';

export const maxDuration = 60;

// techdrip.net の tag → システムカテゴリ変換
const TECHDRIP_CAT_MAP: Record<string, string | null> = {
  'AI':     'エージェント',
  'LLM':    'LLM推論',
  '開発手法': 'ツール/フレームワーク',
  'OSS':    'ツール/フレームワーク',
  'セキュリティ': 'ビジネス応用',
  'クラウド': 'ハードウェア',
  '研究':   '研究/論文',
  'キャリア': 'ビジネス応用',
  '業界':   'ビジネス応用',
  'ガジェット': 'ハードウェア',
  'エンタメ': null, // スキップ
};

function parseTechDripScore(scoreStr: string): number {
  const num = parseInt(scoreStr.replace(/[^\d]/g, ''), 10);
  if (isNaN(num)) return 5;
  if (num >= 400) return 10;
  if (num >= 200) return 9;
  if (num >= 100) return 8;
  if (num >= 50)  return 7;
  if (num >= 20)  return 6;
  return 5;
}

// ITEMS_BY_DATE 形式のページから記事を一括抽出
async function collectFromTechDrip(targetSource: typeof sources.$inferSelect, today: string) {
  const res = await fetch(targetSource.value, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();

  const match = html.match(/const ITEMS_BY_DATE = (\{[\s\S]*?\});\s*\n/);
  if (!match) throw new Error('ITEMS_BY_DATE が見つかりません');

  const itemsByDate: Record<string, any[]> = JSON.parse(match[1]);

  // 日付キーは "2026-5-18" 形式（ゼロ埋めなし）
  const d = new Date(today);
  const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const items: any[] = itemsByDate[dateKey] ?? [];

  if (items.length === 0) {
    return { inserted: 0, skipped: 0, message: `${dateKey} の記事なし` };
  }

  let inserted = 0;
  let skipped = 0;
  const deepFetchUrls: string[] = [];

  for (const item of items) {
    if (item.src === 'gareso') { skipped++; continue; }

    const category = TECHDRIP_CAT_MAP[item.tag ?? ''];
    if (category === null) { skipped++; continue; }

    const rawScore = parseInt((item.score ?? '').replace(/[^\d]/g, ''), 10);
    if (isNaN(rawScore) || rawScore < 20) { skipped++; continue; } // Phase 1: 低品質スキップ

    const tags = JSON.stringify([item.src, item.domain].filter(Boolean).slice(0, 3));
    const importanceScore = parseTechDripScore(item.score ?? '');
    const summary = [item.summary, item.comment_summary].filter(Boolean).join('\n\n').slice(0, 600) || item.title;

    try {
      const result = await db.insert(collectedData).values({
        sourceId: targetSource.id,
        title: item.title,
        url: item.url,
        summary,
        category: category ?? 'その他',
        importanceScore,
        tags,
        publishedAt: new Date().toISOString(),
      }).onConflictDoNothing();

      if (result.rowsAffected > 0) {
        inserted++;
        if (rawScore >= 100 && item.url) deepFetchUrls.push(item.url);
      } else skipped++;
    } catch {
      skipped++;
    }
  }

  // Phase 2: 高スコア記事の元URL から全文取得（最大3件）
  for (const url of deepFetchUrls.slice(0, 3)) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      const html = await res.text();
      const fullText = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 5000);
      await db.update(collectedData)
        .set({ rawContent: fullText })
        .where(eq(collectedData.url, url));
    } catch { /* ignore */ }
  }

  return { inserted, skipped, message: `${inserted}件追加、${skipped}件スキップ` };
}

// キーワード型: Gemini Groundingで検索
async function collectFromKeyword(targetSource: typeof sources.$inferSelect, today: string, sevenDaysAgo: string) {
  const result = await generateText({
    model: google('gemini-2.5-flash-lite'),
    tools: { google_search: google.tools.googleSearch({}) },
    system: `あなたはAI技術情報収集エンジンです。
与えられたキーワードでGoogle検索を行い、過去7日以内（${sevenDaysAgo}〜${today}）に公開・更新されたAI技術に関する実際の記事を1つ見つけてください。
古い記事・既知の情報は除外し、必ず最新の内容を選んでください。
以下のJSONフォーマットのみを出力してください：
{"title": "記事タイトル", "url": "実際の記事URL", "summary": "200文字程度の専門的な要約", "category": "LLM推論|エージェント|ツール/フレームワーク|ハードウェア|ビジネス応用|研究/論文|その他 のいずれか1つ", "importance": 8, "tags": ["タグ1", "タグ2", "タグ3"]}
importanceは1(低)〜10(高)でAI技術的重要度・新規性を評価してください。
tagsは記事内容を表す英語または日本語の短いキーワードを3〜5個選んでください。`,
    prompt: `対象キーワード: ${targetSource.value}\n検索対象期間: ${sevenDaysAgo}〜${today}`,
  });

  const jsonStr = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(jsonStr);
}

export async function POST() {
  try {
    const sourceList = await db.select().from(sources)
      .where(eq(sources.status, 'active'))
      .orderBy(sql`RANDOM()`)
      .limit(1);

    if (sourceList.length === 0) {
      return Response.json({ success: false, message: 'アクティブなシードがありません。' }, { status: 400 });
    }

    const targetSource = sourceList[0];
    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // URL型ソース（techdrip.net等）: 一括取得
    if (targetSource.type === 'url') {
      try {
        const result = await collectFromTechDrip(targetSource, today);
        await db.update(sources)
          .set({ lastHitAt: new Date().toISOString() })
          .where(eq(sources.id, targetSource.id));
        return Response.json({
          success: true,
          message: `[${targetSource.value}] ${result.message}`,
          inserted: result.inserted,
        });
      } catch (e: any) {
        return Response.json({ success: false, message: `URL収集失敗: ${e.message}` }, { status: 500 });
      }
    }

    // キーワード型ソース
    let parsedData: any;
    try {
      parsedData = await collectFromKeyword(targetSource, today, sevenDaysAgo);
    } catch (e: any) {
      return Response.json({ success: false, message: `収集失敗: ${e.message}` }, { status: 500 });
    }

    // タイトル重複チェック
    if (parsedData.title) {
      const existing = await db.select({ id: collectedData.id })
        .from(collectedData)
        .where(eq(collectedData.title, parsedData.title))
        .limit(1);
      if (existing.length > 0) {
        return Response.json({ success: false, message: '同じタイトルの記事が既に存在します。' }, { status: 409 });
      }
    }

    const tagsJson = Array.isArray(parsedData.tags) && parsedData.tags.length > 0
      ? JSON.stringify(parsedData.tags.slice(0, 5).map((t: any) => String(t).trim()))
      : null;

    await db.insert(collectedData).values({
      sourceId: targetSource.id,
      title: parsedData.title,
      url: parsedData.url,
      summary: parsedData.summary,
      category: parsedData.category ?? null,
      importanceScore: parsedData.importance ?? 5,
      tags: tagsJson,
      rawContent: JSON.stringify(parsedData),
      publishedAt: new Date().toISOString(),
    }).onConflictDoNothing();

    await db.update(sources)
      .set({ lastHitAt: new Date().toISOString() })
      .where(eq(sources.id, targetSource.id));

    return Response.json({ success: true, message: 'データの収集に成功しました。', data: parsedData });
  } catch (error: any) {
    console.error("Collection error:", error);
    return Response.json({ success: false, message: error.message }, { status: 500 });
  }
}
