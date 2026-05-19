import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { eq, sql, desc, count, and, gte } from 'drizzle-orm';
import { config } from 'dotenv';
import nodemailer from 'nodemailer';
import * as schema from './src/db/schema';

config({ path: '.env.local' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client, { schema });

const TECHDRIP_CAT_MAP: Record<string, string | null> = {
  'AI': 'エージェント', 'LLM': 'LLM推論', '開発手法': 'ツール/フレームワーク',
  'OSS': 'ツール/フレームワーク', 'セキュリティ': 'ビジネス応用', 'クラウド': 'ハードウェア',
  '研究': '研究/論文', 'キャリア': 'ビジネス応用', '業界': 'ビジネス応用',
  'ガジェット': 'ハードウェア', 'エンタメ': null,
};

function parseTechDripScore(scoreStr: string): number {
  const num = parseInt(scoreStr.replace(/[^\d]/g, ''), 10);
  if (isNaN(num)) return 5;
  if (num >= 400) return 10; if (num >= 200) return 9; if (num >= 100) return 8;
  if (num >= 50) return 7;   if (num >= 20) return 6;  return 5;
}

async function collectData(rounds = 10): Promise<{ collected: number; failed: number }> {
  console.log(`[Collect] ${rounds}ラウンド開始`);
  let collected = 0;
  let failed = 0;
  const today = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // URL型ソース（techdrip.net等）を先に処理
  const urlSources = await db.select().from(schema.sources)
    .where(eq(schema.sources.type, 'url') as any)
    .limit(10);

  for (const target of urlSources) {
    if (target.status !== 'active') continue;
    try {
      const res = await fetch(target.value, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      const html = await res.text();
      const match = html.match(/const ITEMS_BY_DATE = (\{[\s\S]*?\});\s*\n/);
      if (!match) { console.warn(`  スキップ (${target.value}): ITEMS_BY_DATE なし`); continue; }

      const itemsByDate: Record<string, any[]> = JSON.parse(match[1]);
      const d = new Date(today);
      const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      const items: any[] = itemsByDate[dateKey] ?? [];

      let batchInserted = 0;
      const deepFetchUrls: string[] = [];

      for (const item of items) {
        if (item.src === 'gareso') continue;
        const category = TECHDRIP_CAT_MAP[item.tag ?? ''];
        if (category === null) continue;
        const rawScore = parseInt((item.score ?? '').replace(/[^\d]/g, ''), 10);
        if (isNaN(rawScore) || rawScore < 20) continue; // Phase 1: 低品質スキップ
        const summary = [item.summary, item.comment_summary].filter(Boolean).join('\n\n').slice(0, 600) || item.title;
        const tags = JSON.stringify([item.src, item.domain].filter(Boolean).slice(0, 3));
        const r = await db.insert(schema.collectedData).values({
          sourceId: target.id, title: item.title, url: item.url, summary,
          category: category ?? 'その他', importanceScore: parseTechDripScore(item.score ?? ''),
          tags, publishedAt: new Date().toISOString(),
        }).onConflictDoNothing();
        if (r.rowsAffected > 0) {
          batchInserted++;
          collected++;
          if (rawScore >= 100 && item.url) deepFetchUrls.push(item.url);
        }
      }

      // Phase 2: 高スコア記事の元URL から全文取得
      for (const url of deepFetchUrls) {
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
            signal: AbortSignal.timeout(10000),
          });
          const html = await res.text();
          const fullText = html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 5000);
          await db.update(schema.collectedData)
            .set({ rawContent: fullText })
            .where(eq(schema.collectedData.url, url));
          console.log(`    [深掘り] ${url.slice(0, 60)}`);
        } catch { /* ignore */ }
      }

      await db.update(schema.sources).set({ lastHitAt: new Date().toISOString() }).where(eq(schema.sources.id, target.id));
      console.log(`  [${target.value}] ${dateKey}: ${batchInserted}件追加`);
    } catch (e: any) {
      console.error(`  URL収集失敗 (${target.value}): ${e.message}`);
      failed++;
    }
  }

  // キーワード型ソース
  for (let i = 0; i < rounds; i++) {
    const sourceList = await db.select().from(schema.sources)
      .where(eq(schema.sources.status, 'active'))
      .orderBy(sql`RANDOM()`)
      .limit(1);

    if (sourceList.length === 0) break;
    const target = sourceList[0];
    if (target.type === 'url') continue; // 既に処理済み

    try {
      const result = await generateText({
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
{"title": "記事タイトル", "url": "実際の記事URL", "publishedAt": "YYYY-MM-DD", "summary": "200文字程度の専門的な要約", "category": "LLM推論|エージェント|ツール/フレームワーク|ハードウェア|ビジネス応用|研究/論文|その他 のいずれか1つ", "importance": 8, "tags": ["tag1", "tag2"]}
importanceは1〜10でAI技術的重要度を評価。tagsは3〜5個の短いキーワード。`,
        prompt: `対象キーワード: ${target.value}\n検索対象期間: ${sevenDaysAgo}〜${today}`,
      });

      const jsonStr = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(jsonStr);

      // グラウンディングの実URLでハルシネーションを上書き
      const googleMeta = (result.providerMetadata?.google ?? (result as any).experimental_providerMetadata?.google) as any;
      const groundingChunks: any[] = googleMeta?.groundingMetadata?.groundingChunks ?? [];
      const groundingUrl = groundingChunks.find((c: any) => c.web?.uri)?.web?.uri;
      if (groundingUrl) parsedData.url = groundingUrl;

      // 鮮度チェック: 14日以上前の記事は破棄
      if (parsedData.publishedAt) {
        const pubDate = new Date(parsedData.publishedAt);
        const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        if (pubDate < cutoff) {
          console.warn(`  スキップ (古い記事 ${parsedData.publishedAt}): ${target.value}`);
          continue;
        }
      }

      const tagsJson = Array.isArray(parsedData.tags) && parsedData.tags.length > 0
        ? JSON.stringify(parsedData.tags.slice(0, 5).map((t: any) => String(t).trim())) : null;

      await db.insert(schema.collectedData).values({
        sourceId: target.id, title: parsedData.title, url: parsedData.url,
        summary: parsedData.summary, category: parsedData.category ?? null,
        importanceScore: parsedData.importance ?? 5, tags: tagsJson,
        rawContent: result.text,
        publishedAt: parsedData.publishedAt ? new Date(parsedData.publishedAt).toISOString() : new Date().toISOString(),
      }).onConflictDoNothing();

      await db.update(schema.sources).set({ lastHitAt: new Date().toISOString() }).where(eq(schema.sources.id, target.id));
      collected++;
      console.log(`  収集: [${parsedData.category ?? '未分類'}] ${parsedData.title} (${parsedData.publishedAt ?? '日付不明'})`);
    } catch (e: any) {
      console.error(`  失敗 (${target.value}): ${e.message}`);
      failed++;
    }
  }

  console.log(`[Collect] ${collected}件完了, ${failed}件失敗`);
  return { collected, failed };
}

async function generateReport(): Promise<string | null> {
  console.log('[Report] レポート生成開始');

  const recentData = await db.select().from(schema.collectedData)
    .orderBy(desc(schema.collectedData.createdAt))
    .limit(10);

  if (recentData.length === 0) { console.log('[Report] データなし、スキップ'); return null; }

  const contextStr = recentData
    .map(d => `[${d.category ?? '未分類'}] ${d.title}\n${d.summary}\nURL: ${d.url}`)
    .join('\n\n---\n\n');

  const todayJST = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });
  const reportDateJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD

  const { text } = await generateText({
    model: google('gemini-2.5-flash-lite'),
    system: `AIテック情報のデイリーレポートをMarkdown形式で作成してください。
エンジニア向けに具体的・実践的なトーンで1200文字程度。
箇条書きや絵文字を活用して読みやすくしてください。`,
    prompt: `今日の日付: ${todayJST}\n\n【収集データ】\n${contextStr}`,
  });

  const [insertedReport] = await db.insert(schema.reports).values({
    type: 'daily',
    content: text,
    reportDate: reportDateJST,
  }).returning({ id: schema.reports.id });

  // 採用ソースをログ記録（ライフサイクル判定に使用）
  const adoptedSourceIds = [...new Set(
    recentData.map(d => d.sourceId).filter((id): id is number => id !== null)
  )];
  if (insertedReport?.id && adoptedSourceIds.length > 0) {
    await db.insert(schema.adoptionLogs).values(
      adoptedSourceIds.map(sourceId => ({
        reportId: insertedReport.id,
        sourceId,
        isAdopted: 1 as const,
      }))
    );
  }

  console.log('[Report] レポート生成完了');
  return text;
}

async function sendEmail(reportContent: string) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.log('[Email] GMAIL_USER/GMAIL_APP_PASSWORD未設定、スキップ');
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });

    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });

    await transporter.sendMail({
      from: user,
      to: user,
      subject: `🤖 AI Tech Researcher デイリーレポート ${today}`,
      text: reportContent,
    });

    console.log('[Email] レポート送信完了');
  } catch (e: any) {
    console.error(`[Email] 送信失敗: ${e.message}`);
  }
}

async function evolveSources() {
  console.log('[Evolve] ソース進化開始');

  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const allSources = await db.select().from(schema.sources)
    .where(sql`${schema.sources.status} != 'stopped'`);

  // バッチ取得: 14日以内のヒット数（ソース別）
  const hitCounts = await db.select({
    sourceId: schema.collectedData.sourceId,
    cnt: count(),
  })
    .from(schema.collectedData)
    .where(gte(schema.collectedData.createdAt, fourteenDaysAgo))
    .groupBy(schema.collectedData.sourceId);
  const hitCountMap = new Map(hitCounts.map(h => [h.sourceId, Number(h.cnt)]));

  // バッチ取得: 最終採用日時（ソース別）
  const lastAdoptions = await db.select({
    sourceId: schema.adoptionLogs.sourceId,
    lastAt: sql<string>`MAX(${schema.adoptionLogs.createdAt})`,
  })
    .from(schema.adoptionLogs)
    .where(eq(schema.adoptionLogs.isAdopted, 1))
    .groupBy(schema.adoptionLogs.sourceId);
  const lastAdoptionMap = new Map(lastAdoptions.map(a => [a.sourceId, a.lastAt]));

  let promoted = 0, demoted = 0, reactivated = 0, stoppedCount = 0;
  const updates: Array<{ id: number; status: string }> = [];

  for (const source of allSources) {
    const daysSinceCreated = (now.getTime() - new Date(source.createdAt ?? now).getTime()) / 86400000;
    const hitCount14d = hitCountMap.get(source.id) ?? 0;
    const lastAdoptedAt = lastAdoptionMap.get(source.id);
    const daysSinceAdopted = lastAdoptedAt
      ? (now.getTime() - new Date(lastAdoptedAt).getTime()) / 86400000
      : Infinity;

    let newStatus: string = source.status ?? 'candidate';

    if (source.status === 'candidate') {
      // 14日で3回ヒット + レポート採用 → active
      if (hitCount14d >= 3 && lastAdoptedAt) {
        newStatus = 'active'; promoted++;
      // 30日間条件未達 → stopped
      } else if (daysSinceCreated >= 30) {
        newStatus = 'stopped'; stoppedCount++;
      }
    } else if (source.status === 'active') {
      // 14日間レポート採用なし → low-priority
      if (daysSinceAdopted >= 14) { newStatus = 'low-priority'; demoted++; }
    } else if (source.status === 'low-priority') {
      // 再びレポート採用 → active
      if (daysSinceAdopted < 14) { newStatus = 'active'; reactivated++;
      // 30日間採用なし → stopped
      } else if (daysSinceAdopted >= 30) { newStatus = 'stopped'; stoppedCount++; }
    }

    if (newStatus !== source.status) updates.push({ id: source.id, status: newStatus });
  }

  for (const u of updates) {
    await db.update(schema.sources).set({ status: u.status }).where(eq(schema.sources.id, u.id));
  }

  console.log(`[Evolve] 昇格${promoted}, 降格${demoted}, 再活性化${reactivated}, 停止${stoppedCount}`);

  // 新規キーワード候補の発見
  const recentData = await db.select({ summary: schema.collectedData.summary })
    .from(schema.collectedData)
    .orderBy(desc(schema.collectedData.createdAt))
    .limit(20);

  if (recentData.length > 0) {
    const { text } = await generateText({
      model: google('gemini-2.5-flash-lite'),
      prompt: `以下の記事サマリーから新興AIキーワードを5つ抽出してJSON配列のみで出力: ["kw1", "kw2", ...]

${recentData.map(d => d.summary).join('\n')}`,
    });

    try {
      const kws: string[] = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
      let added = 0;
      for (const kw of kws) {
        const res = await db.insert(schema.sources)
          .values({ type: 'keyword', value: kw.trim(), status: 'candidate', score: 0 })
          .onConflictDoNothing();
        if (res.rowsAffected > 0) added++;
      }
      console.log(`[Evolve] 新規候補${added}件追加`);
    } catch { /* ignore */ }
  }
}

async function logPipeline(collected: number, failed: number, durationMs: number) {
  try {
    await db.insert(schema.pipelineLogs).values({
      date: new Date().toISOString().split('T')[0],
      collected,
      failed,
      durationMs,
    });
    console.log(`[Log] パイプライン記録: 収集${collected}件, 失敗${failed}件, ${Math.round(durationMs / 1000)}秒`);
  } catch (e: any) {
    console.warn('[Log] ログ記録失敗(非クリティカル):', e.message);
  }
}

async function main() {
  const startTime = Date.now();
  console.log('=== Daily Pipeline 開始 ===', new Date().toISOString());

  const { collected, failed } = await collectData(10);
  const reportContent = await generateReport();
  if (reportContent) {
    await sendEmail(reportContent);
  }
  await evolveSources();

  const durationMs = Date.now() - startTime;
  await logPipeline(collected, failed, durationMs);

  console.log('=== Daily Pipeline 完了 ===');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
