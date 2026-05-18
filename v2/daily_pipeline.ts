import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { eq, sql, desc } from 'drizzle-orm';
import { config } from 'dotenv';
import nodemailer from 'nodemailer';
import * as schema from './src/db/schema';
import { inArray } from 'drizzle-orm';

config({ path: '.env.local' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client, { schema });

async function collectData(rounds = 10): Promise<{ collected: number; failed: number }> {
  console.log(`[Collect] ${rounds}ラウンド開始`);
  let collected = 0;
  let failed = 0;

  for (let i = 0; i < rounds; i++) {
    const sourceList = await db.select().from(schema.sources)
      .where(eq(schema.sources.status, 'active'))
      .orderBy(sql`RANDOM()`)
      .limit(1);

    if (sourceList.length === 0) break;
    const target = sourceList[0];

    try {
      const today = new Date().toISOString().split('T')[0];
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const result = await generateText({
        model: google('gemini-2.5-flash-lite'),
        tools: { google_search: google.tools.googleSearch({}) },
        system: `あなたはAI技術情報収集エンジンです。
与えられたキーワードでGoogle検索を行い、過去7日以内（${sevenDaysAgo}〜${today}）に公開・更新されたAI技術に関する実際の記事を1つ見つけてください。
古い記事・既知の情報は除外し、必ず最新の内容を選んでください。
以下のJSONフォーマットのみを出力してください：
{"title": "記事タイトル", "url": "実際の記事URL", "summary": "200文字程度の専門的な要約", "category": "LLM推論|エージェント|ツール/フレームワーク|ハードウェア|ビジネス応用|研究/論文|その他 のいずれか1つ", "importance": 8, "tags": ["tag1", "tag2"]}
importanceは1〜10でAI技術的重要度を評価。tagsは3〜5個の短いキーワード。`,
        prompt: `対象キーワード: ${target.value}\n検索対象期間: ${sevenDaysAgo}〜${today}`,
      });

      let parsedData;
      try {
        const jsonStr = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedData = JSON.parse(jsonStr);
      } catch {
        console.warn(`  スキップ (${target.value}): JSON解析失敗`);
        failed++;
        continue;
      }

      const tagsJson = Array.isArray(parsedData.tags) && parsedData.tags.length > 0
        ? JSON.stringify(parsedData.tags.slice(0, 5).map((t: any) => String(t).trim()))
        : null;

      await db.insert(schema.collectedData).values({
        sourceId: target.id,
        title: parsedData.title,
        url: parsedData.url,
        summary: parsedData.summary,
        category: parsedData.category ?? null,
        importanceScore: parsedData.importance ?? 5,
        tags: tagsJson,
        rawContent: result.text,
        publishedAt: new Date().toISOString(),
      }).onConflictDoNothing();

      await db.update(schema.sources)
        .set({ lastHitAt: new Date().toISOString() })
        .where(eq(schema.sources.id, target.id));

      collected++;
      console.log(`  収集: [${parsedData.category ?? '未分類'}] ${parsedData.title}`);
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

  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  const { text } = await generateText({
    model: google('gemini-2.5-flash-lite'),
    system: `AIテック情報のデイリーレポートをMarkdown形式で作成してください。
エンジニア向けに具体的・実践的なトーンで1200文字程度。
箇条書きや絵文字を活用して読みやすくしてください。`,
    prompt: `今日の日付: ${today}\n\n【収集データ】\n${contextStr}`,
  });

  await db.insert(schema.reports).values({
    type: 'daily',
    content: text,
    reportDate: new Date().toISOString().split('T')[0],
  });

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

    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

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

  const allSources = await db.select().from(schema.sources)
    .where(sql`${schema.sources.status} != 'stopped'`);

  let promoted = 0, demoted = 0, stoppedCount = 0;

  for (const source of allSources) {
    const logs = await db.select().from(schema.adoptionLogs)
      .where(eq(schema.adoptionLogs.sourceId, source.id));

    const adopted = logs.filter(l => l.isAdopted === 1).length;
    const notAdopted = logs.filter(l => l.isAdopted === 0).length;
    const scoreDelta = logs.length === 0 ? -1 : adopted * 10 - notAdopted * 2;
    const newScore = (source.score ?? 0) + scoreDelta;

    let newStatus = source.status;
    if (source.status === 'candidate' && newScore >= 30) { newStatus = 'active'; promoted++; }
    else if (source.status === 'active' && newScore < 0) { newStatus = 'low-priority'; demoted++; }
    else if (source.status === 'low-priority' && newScore < -20) { newStatus = 'stopped'; stoppedCount++; }

    await db.update(schema.sources)
      .set({ score: newScore, status: newStatus })
      .where(eq(schema.sources.id, source.id));
  }

  console.log(`[Evolve] 昇格${promoted}, 降格${demoted}, 停止${stoppedCount}`);

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
