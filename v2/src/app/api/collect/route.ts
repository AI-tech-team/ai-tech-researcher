import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { sources, collectedData } from '@/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { withRetry, extractJson, resolveGroundingUrl } from '@/lib/llm';
import { isOwner } from '@/lib/owner';
import { checkRateLimit } from '@/lib/ratelimit';

export const maxDuration = 60;

const GROUNDING_SKIP_DOMAINS = ['google.', 'youtube.', 'wikipedia.', 't.co', 'twitter.', 'x.com'];

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
    // http(s)以外のURL（javascript:/data: 等）は保存しない（描画時のstored XSS対策）
    if (!/^https?:\/\//i.test(item.url ?? '')) { skipped++; continue; }

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
        publishedAt: today + 'T00:00:00.000Z',
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

interface KeywordArticle {
  title: string; url: string; publishedAt?: string; summary?: string;
  category?: string; importance?: number; tags?: string[];
}

// キーワード型: Gemini Groundingで検索（リトライ＋堅牢なJSON抽出）
async function collectFromKeyword(targetSource: typeof sources.$inferSelect, today: string, sevenDaysAgo: string): Promise<KeywordArticle> {
  const result = await withRetry(() => generateText({
    model: google('gemini-2.5-flash-lite'),
    tools: { google_search: google.tools.googleSearch({}) },
    system: `あなたはAI技術情報収集エンジンです。
与えられたキーワードでGoogle検索を行い、${sevenDaysAgo}〜${today} の期間に公開されたAI技術記事を1つ見つけてください。

【必須制約】
- 検索クエリに "after:${sevenDaysAgo}" を含めること
- 公開日が ${sevenDaysAgo} より古い記事は絶対に使用しない
- URLは検索結果に実在するURLのみ使用する（推測・生成禁止）
- 公開日が不明な場合は別の記事を探す

以下のJSONフォーマットのみを出力してください：
{"title": "記事タイトル", "url": "実際の記事URL", "publishedAt": "YYYY-MM-DD", "summary": "200文字程度の専門的な要約", "category": "LLM推論|エージェント|ツール/フレームワーク|ハードウェア|ビジネス応用|研究/論文|その他 のいずれか1つ", "importance": 8, "tags": ["タグ1", "タグ2", "タグ3"]}
importanceは1(低)〜10(高)でAI技術的重要度・新規性を評価。tagsは3〜5個。`,
    prompt: `対象キーワード: ${targetSource.value}\n検索対象期間: ${sevenDaysAgo}〜${today}`,
  }));

  const parsedData = extractJson<KeywordArticle>(result.text);

  // グラウンディングの実URLでハルシネーションを上書き（実在URLを優先しURL健全性を担保）
  const googleMeta = (result.providerMetadata?.google ?? (result as { experimental_providerMetadata?: { google?: unknown } }).experimental_providerMetadata?.google) as
    { groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> } } | undefined;
  const groundingChunks = googleMeta?.groundingMetadata?.groundingChunks ?? [];
  const groundingUrl = groundingChunks
    .map(c => c.web?.uri)
    .filter((uri): uri is string => !!uri)
    .find(uri => !GROUNDING_SKIP_DOMAINS.some(d => uri.includes(d)));
  // グラウンディングのリダイレクトURLは実URLに解決して埋め込む（404防止）
  if (groundingUrl) {
    const resolved = await resolveGroundingUrl(groundingUrl);
    if (resolved) parsedData.url = resolved;
  }

  // URL妥当性チェック（不正・推測URLを弾く）
  if (!parsedData.url || !parsedData.title) throw new Error('title/URLが取得できませんでした');
  // 解決できなかったグラウンディングURLが残っている場合は弾く
  if (/vertexaisearch\.cloud\.google\.com|grounding-api-redirect/.test(parsedData.url)) {
    throw new Error('リダイレクトURLを解決できませんでした');
  }
  try {
    const u = new URL(parsedData.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('non-http scheme');
  } catch { throw new Error(`無効なURL: ${String(parsedData.url).slice(0, 60)}`); }

  // 鮮度チェック: 14日以上前の記事は破棄
  if (parsedData.publishedAt) {
    const pubDate = new Date(parsedData.publishedAt);
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    if (pubDate < cutoff) {
      throw new Error(`古い記事のためスキップ (${parsedData.publishedAt}): ${parsedData.url}`);
    }
  }

  return parsedData;
}

export async function POST() {
  if (!(await isOwner())) return Response.json({ success: false, message: 'オーナー権限が必要です' }, { status: 403 });
  if (!(await checkRateLimit('pipeline', 'owner', 5, 60_000))) return Response.json({ success: false, message: 'レート制限に達しました。少し待ってください' }, { status: 429 });
  try {
    // 1件のソース失敗でSYNC全体を失敗にしないため、複数候補を順に試行
    const candidates = await db.select().from(sources)
      .where(and(
        eq(sources.status, 'active'),
        sql`${sources.type} IN ('url', 'keyword')`,
      ))
      .orderBy(sql`RANDOM() * (1 + COALESCE(${sources.score}, 0)) DESC`)
      .limit(5);

    if (candidates.length === 0) {
      return Response.json({ success: false, message: 'アクティブなシードがありません。' }, { status: 400 });
    }

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    const attemptNotes: string[] = [];

    for (const targetSource of candidates) {
      // URL型ソース（techdrip.net等）: 一括取得
      if (targetSource.type === 'url') {
        try {
          const result = await collectFromTechDrip(targetSource, today);
          await db.update(sources).set({ lastHitAt: new Date().toISOString() }).where(eq(sources.id, targetSource.id));
          if (result.inserted > 0) {
            return Response.json({ success: true, message: `[${targetSource.value}] ${result.message}`, inserted: result.inserted });
          }
          attemptNotes.push(`${targetSource.value}: 新着なし`);
          continue;
        } catch (e) {
          attemptNotes.push(`${targetSource.value}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 80));
          continue;
        }
      }

      // キーワード型ソース
      let parsedData: KeywordArticle;
      try {
        parsedData = await collectFromKeyword(targetSource, today, sevenDaysAgo);
      } catch (e) {
        attemptNotes.push(`${targetSource.value}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 80));
        continue; // 古い記事・解析失敗等は次のソースへ
      }

      // タイトル重複チェック → 重複なら次のソースへ
      const existing = await db.select({ id: collectedData.id })
        .from(collectedData).where(eq(collectedData.title, parsedData.title)).limit(1);
      if (existing.length > 0) {
        attemptNotes.push(`${targetSource.value}: 既存記事と重複`);
        continue;
      }

      const tagsJson = Array.isArray(parsedData.tags) && parsedData.tags.length > 0
        ? JSON.stringify(parsedData.tags.slice(0, 5).map(t => String(t).trim()))
        : null;
      const importance = parsedData.importance ?? 5;

      const insertResult = await db.insert(collectedData).values({
        sourceId: targetSource.id,
        title: parsedData.title,
        url: parsedData.url,
        summary: parsedData.summary,
        category: parsedData.category ?? null,
        importanceScore: importance,
        tags: tagsJson,
        rawContent: JSON.stringify(parsedData),
        publishedAt: parsedData.publishedAt ? new Date(parsedData.publishedAt).toISOString() : new Date().toISOString(),
      }).onConflictDoNothing();

      await db.update(sources).set({ lastHitAt: new Date().toISOString() }).where(eq(sources.id, targetSource.id));

      if (insertResult.rowsAffected > 0) {
        if (importance >= 7) {
          const boost = Math.min(2.0, (importance - 6) * 0.5);
          await db.update(sources)
            .set({ score: sql`COALESCE(${sources.score}, 0.0) + ${boost}` })
            .where(eq(sources.id, targetSource.id));
        }
        return Response.json({ success: true, message: `「${targetSource.value}」から1件収集しました。`, data: parsedData });
      }
      attemptNotes.push(`${targetSource.value}: URL重複`);
    }

    // どのソースからも新着が得られなかった場合もエラーにはしない
    return Response.json({
      success: true,
      inserted: 0,
      message: `新着記事は見つかりませんでした（${candidates.length}件のソースを確認）`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Collection error:', error);
    return Response.json({ success: false, message: msg }, { status: 500 });
  }
}
