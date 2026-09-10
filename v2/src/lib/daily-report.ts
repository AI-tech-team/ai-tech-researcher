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

/** 候補として引く件数。ここからドメイン上限を掛けて TOP_N まで絞る。 */
const CANDIDATE_LIMIT = 120;
/** レポートの素材として LLM に渡す上限（旧実装の LIMIT 40 と同じ）。 */
const TOP_N = 40;
/** 1ドメインが取れる最大枠。上位20本のうち5本がApple関連という日が実在した（2026-09-10 実測）。 */
const PER_DOMAIN_CAP = 5;

function domainOf(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/**
 * 並び順を保ったまま、1ドメインの本数に上限を掛けて上位 `limit` 件を返す。
 * 上限で弾かれた記事は捨てず、枠が余ったら順に補充する（欠落より冗長を選ぶ）。
 */
export function pickTopWithDomainCap<T extends { url: string | null }>(
  rows: T[], limit = TOP_N, cap = PER_DOMAIN_CAP,
): T[] {
  const used = new Map<string, number>();
  const picked: T[] = [];
  const overflow: T[] = [];
  for (const r of rows) {
    if (picked.length >= limit) break;
    const d = domainOf(r.url);
    const n = used.get(d) ?? 0;
    if (d && n >= cap) { overflow.push(r); continue; }
    used.set(d, n + 1);
    picked.push(r);
  }
  for (const r of overflow) {
    if (picked.length >= limit) break;
    picked.push(r);
  }
  return picked;
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
    // 新着記事のみ（重要度順は新着期間の中だけで適用）。
    //
    // ⚠️ 第2ソートキーが `created_at DESC` だった間、選別は実質「クロール挿入時刻」で決まっていた。
    // importance_score は整数7値で86.8%が4値に集中し、1日約230本が流入するので、LIMIT 40 の
    // 切断面は必ず同点の塊の内部に落ちる（過去21日で例外なし）。直近14日の同点帯1,005本のうち
    // 445本(44.3%)が「同じスコアなのに」脱落し、採用率に startupfortune 67% / TechCrunch 43% の
    // ような差が出ていた。しかも新しい記事ほど本文が未取得なので、
    // **最も情報を持たない記事を最優先で選ぶ**状態になっていた（2026-09-10 監査）。
    //
    // 同点を解くのは以下の順。いずれも既にDBにある量で、LLMもコストも増やさない:
    //   1. story_count      何本の報道が同じ出来事を扱ったか＝注目度の実測値
    //   2. 本文の有無        読んでいない記事より読んだ記事を上に
    //   3. published_at     クロール時刻ではなく実際の公開時刻
    //   4. id               最後の決定論的な綱引き（実行ごとに順序が変わらないように）
    // ドメイン上限は下の pickTop40 で掛ける（1社が枠を占拠しないように）。
    db.select().from(collectedData)
      .where(gte(collectedData.createdAt, since))
      .orderBy(
        desc(collectedData.importanceScore),
        desc(sql`COALESCE(${collectedData.storyCount}, 1)`),
        desc(sql`CASE WHEN ${collectedData.rawContent} IS NOT NULL AND LENGTH(${collectedData.rawContent}) > 200 THEN 1 ELSE 0 END`),
        desc(sql`COALESCE(${collectedData.publishedAt}, ${collectedData.createdAt})`),
        desc(collectedData.id),
      )
      .limit(CANDIDATE_LIMIT),
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

  // 1社が朝刊を占拠しないようにドメイン上限を掛けてから上位40件に絞る
  const topRecent = pickTopWithDomainCap(rawRecent, TOP_N, PER_DOMAIN_CAP);

  // 重複ストーリーを代表1件に集約
  const seenStory = new Set<number>();
  const recentData: typeof rawRecent = [];
  for (const d of topRecent) {
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
  // ⚠️ 以前はここを【検証済みの事実・数値（根拠として引用してよい）】と称していた。中身は
  // arXiv 論文のアブストラクトから抜いた**著者の自己申告**（例:「自己進化により手動エンジニアリング
  // なしで性能が向上する|True」）で、検証されたものではない。その結果 2026-09-10 配信のレポートに
  //「（検証済みデータ：処理可能なモダリティ = 医療画像…）」のような表現が実際に出ていた。
  // confidence も 91.7% が 'high' の定数で、真偽の情報を持っていない（2026-09-10 監査）。
  const evidenceText = evidenceLines.length > 0
    ? '\n\n【記事から抽出した記述・未検証（発表者側の主張。「検証済み」と書かないこと。引用する場合は誰の主張かを明示する）】\n'
      + evidenceLines.join('\n')
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
