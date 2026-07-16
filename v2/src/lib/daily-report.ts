// 日次レポート生成の単一実装。サイト掲載・購読者メール・オーナー手動再生成のすべてがここを通る。
// 鮮度の原則: 対象は「前回dailyレポート以降に収集された新着記事」のみ。
// 昨日のレポートで使った記事が重要度順で再登場して新着を押し出す問題を、期間の切り方で構造的に防ぐ。
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { collectedData, reports, claims, benchmarks, adoptionLogs } from '@/db/schema';
import { desc, gte, and, lt, eq, count, sql } from 'drizzle-orm';
import { withRetry } from '@/lib/llm';

// SQLite/libSQL の CURRENT_TIMESTAMP は 'YYYY-MM-DD HH:MM:SS'(空白区切り・UTC)で格納される。
// 比較しきい値はこの形式に揃える（ISOの'T'区切りだと字句比較で境界日がズレる）。
const sqlTs = (d: Date): string => d.toISOString().replace('T', ' ').slice(0, 19);

// 'YYYY-MM-DD HH:MM:SS'(UTC) → epoch ms。パース不能は null。
function parseSqlTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = new Date(s.replace(' ', 'T') + 'Z').getTime();
  return Number.isFinite(ms) ? ms : null;
}

export interface DailyReportResult {
  inserted: typeof reports.$inferSelect;
  text: string;
}

export async function buildDailyReport(): Promise<DailyReportResult | null> {
  const now = Date.now();

  // 前回のdailyレポート（新着期間の起点＋「繰り返し禁止」の比較対象）
  const [prevDaily] = await db.select({
    content: reports.content, createdAt: reports.createdAt, reportDate: reports.reportDate,
  })
    .from(reports)
    .where(and(eq(reports.type, 'daily'), sql`length(${reports.content}) > 0`))
    .orderBy(desc(reports.createdAt))
    .limit(1);

  // 新着期間 = 前回daily生成時刻以降。ただし 20〜48時間に収める:
  // - 下限20h: 手動再生成の直後でも直近1日分は対象に残す
  // - 上限48h: パイプライン停止明けでも古い記事でレポートが埋まらない
  const prevMs = parseSqlTs(prevDaily?.createdAt);
  const sinceMs = prevMs != null
    ? Math.max(now - 48 * 3_600_000, Math.min(prevMs, now - 20 * 3_600_000))
    : now - 24 * 3_600_000;
  const since = sqlTs(new Date(sinceMs));
  const sevenDaysAgo = sqlTs(new Date(now - 7 * 86_400_000));
  const fourteenDaysAgo = sqlTs(new Date(now - 14 * 86_400_000));

  const [rawRecent, thisWeekCounts, lastWeekCounts, recentClaims, recentBench] = await Promise.all([
    // 新着記事のみ（重要度順は新着期間の中だけで適用）
    db.select().from(collectedData)
      .where(gte(collectedData.createdAt, since))
      .orderBy(desc(collectedData.importanceScore), desc(collectedData.createdAt))
      .limit(40),
    // カテゴリ別トレンドは文脈情報なので週次窓のまま
    db.select({ category: collectedData.category, cnt: count() })
      .from(collectedData).where(gte(collectedData.createdAt, sevenDaysAgo)).groupBy(collectedData.category),
    db.select({ category: collectedData.category, cnt: count() })
      .from(collectedData)
      .where(and(gte(collectedData.createdAt, fourteenDaysAgo), lt(collectedData.createdAt, sevenDaysAgo)))
      .groupBy(collectedData.category),
    // 根拠となる事実・数値も新着分のみ（古い事実で昨日の話題を再構成させない）
    db.select({ subject: claims.subject, predicate: claims.predicate, value: claims.value })
      .from(claims)
      .where(and(eq(claims.status, 'active'), gte(claims.createdAt, since)))
      .orderBy(desc(claims.createdAt)).limit(12),
    db.select({ entityName: benchmarks.entityName, benchmarkName: benchmarks.benchmarkName, score: benchmarks.score, unit: benchmarks.unit })
      .from(benchmarks).where(gte(benchmarks.createdAt, since)).orderBy(desc(benchmarks.createdAt)).limit(12),
  ]);

  if (rawRecent.length === 0) return null;

  // 重複ストーリーを代表1件に集約
  const seenStory = new Set<number>();
  const recentData: typeof rawRecent = [];
  for (const d of rawRecent) {
    if (d.storyId != null) { if (seenStory.has(d.storyId)) continue; seenStory.add(d.storyId); }
    recentData.push(d);
    if (recentData.length >= 15) break;
  }

  const contextStr = recentData
    .map(d => {
      // storyCountは「同一ストーリーの記事数」であって媒体数ではない（実測: 160件のstoryでも実媒体は6）。
      // 「N媒体が報じた」と書くとLLMがその誇張をそのままレポートに載せるため、件数として渡す。
      const multi = (d.storyCount ?? 1) > 1 ? `（同一トピックで${d.storyCount}件）` : '';
      return `[重要度:${d.importanceScore ?? 5}/10][${d.category ?? '未分類'}]${multi} ${d.titleJa || d.title}\n${d.summary}\nURL: ${d.url}\n公開日: ${d.publishedAt?.split('T')[0] ?? '不明'}`;
    })
    .join('\n\n---\n\n');

  const evidenceLines = [
    ...recentClaims.map(c => `- ${c.subject}: ${c.predicate} = ${c.value}`),
    ...recentBench.map(b => `- ${b.entityName} / ${b.benchmarkName}: ${b.score}${b.unit ?? ''}`),
  ];
  const evidenceText = evidenceLines.length > 0
    ? '\n\n【検証済みの事実・数値（根拠として引用してよい）】\n' + evidenceLines.join('\n')
    : '';

  const lastWeekMap = new Map(lastWeekCounts.map(r => [r.category, Number(r.cnt)]));
  const trendLines = thisWeekCounts
    .map(r => ({ cat: r.category ?? 'その他', now: Number(r.cnt), prev: lastWeekMap.get(r.category ?? '') ?? 0 }))
    .filter(r => r.now >= 2)
    .map(r => ({ ...r, ratio: r.prev === 0 ? r.now * 2 : r.now / r.prev }))
    .sort((a, b) => b.ratio - a.ratio).slice(0, 5)
    .map(r => `${r.cat}: 今週${r.now}件/先週${r.prev}件${r.ratio >= 2 ? ' 🚀急上昇' : r.ratio >= 1.3 ? ' ↑上昇' : r.ratio <= 0.7 ? ' ↓減少' : ''}`);
  const trendText = trendLines.length > 0 ? '\n\n【カテゴリ別週次トレンド（参考データ）】\n' + trendLines.join('\n') : '';

  // 前回レポート: 「既報の焼き直し禁止」の判定材料として渡す
  const prevSection = prevDaily?.content
    ? `\n\n【前回のレポート（${prevDaily.reportDate}・重複回避用）】\n${prevDaily.content.slice(0, 1200)}`
    : '';

  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });

  const { text } = await withRetry(() => generateText({
    model: google('gemini-2.5-flash'),
    system: `あなたはAI技術動向の専門アナリストです。収集データを元に、AIエンジニア・研究者向けのデイリーレポートをMarkdown形式で作成してください。

【必須構成】
## 🔥 今日のハイライト
重要度8以上の記事を中心に3〜5点。各項目は「何が起きたか」「なぜ重要か」「実務への影響」を2〜3行で。

## 🚀 急上昇トレンド
トレンドデータを参考に、今週急増しているカテゴリ・トピックを1段落で解説。

## 📊 カテゴリ別トピック
カテゴリごとに整理。

## 💡 エンジニアへの実践的インサイト
実装・採用・評価のポイントを箇条書きで。

【ルール】
- 全体1500〜2000文字
- 収集データは前回レポート以降の新着のみ。**前回レポートで既に扱った話題は、新しい進展がある場合だけ「続報」として扱い、単なる繰り返し・焼き直しは禁止**
- 提示された「検証済みの事実・数値」は積極的に根拠として引用する
- 主観でなく客観的な事実ベースで記述
- 絵文字・箇条書きを活用`,
    prompt: `今日の日付: ${today}${trendText}${evidenceText}${prevSection}\n\n【新着の収集データ（重要度順・${recentData.length}件）】\n${contextStr}`,
  }));

  // LLMが空応答を返すことがある。空レポートを最新dailyとして保存すると購読者メールのダイジェストが消えるため、保存せずnullを返す。
  if (!text?.trim()) { console.warn('[Report] 空レポートのため保存をスキップ'); return null; }

  const reportDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const [inserted] = await db.insert(reports).values({ type: 'daily', content: text, reportDate }).returning();

  // 採用ログ（ソーススコアの根拠）
  const adoptedSourceIds = [...new Set(recentData.map(d => d.sourceId).filter((v): v is number => v != null))];
  if (inserted?.id && adoptedSourceIds.length > 0) {
    await db.insert(adoptionLogs).values(adoptedSourceIds.map(sourceId => ({ reportId: inserted.id, sourceId, isAdopted: 1 as const })));
  }

  return { inserted, text };
}
