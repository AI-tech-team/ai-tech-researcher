/**
 * 延命モード（SNAPSHOT_MODE）のデータ源。
 *
 * 2026-09-15、Turso Free の月500M行読み取りを使い切り `BLOCKED` で**読み取りが全部落ちた**。
 * リセットはカレンダー月なので10月1日まで戻らない。書き込みは通るが、読めなければ何も表示できない。
 * → 週次バックアップから作った静的スナップショット（scripts/build_snapshot.ts）を配る。
 *
 * 方針:
 *  - DBを一切引かない。`SNAPSHOT_MODE` が立っている間、公開面はここだけを見る。
 *  - 「BLOCKEDを検知して自動で切り替える」ようにはしない。**一部DB・一部スナップショットの
 *    中途半端な状態**（同じページの中で新旧が混ざる）を作らないため、env 1本で全部切り替える。
 *  - 復旧したら env を外すだけで元に戻る。コード変更は要らない。
 *
 * ⚠ 抽出本文(rawContent)はバックアップ自体に含まれない（第三条・公衆送信の回避）ので、
 *   このスナップショットにも入っていない＝公開してよい範囲しか持たない。
 */
import snap from '@/data/snapshot.json';

// ⚠ DB の列定義に合わせる（schema.ts:67-73）。reportDate が notNull で createdAt が nullable。
//    ここを取り違えると getReportsData の返り値がユニオンで広がり、feed.xml の rfc822() が通らない。
export type SnapshotReport = {
  id: number; type: string; reportDate: string; createdAt: string | null; content: string;
};

type SnapshotFile = {
  generatedAt: string;
  sourceBackup: string;
  dataDate: string;
  articleCount: number;
  reports: SnapshotReport[];
  articles: Record<string, unknown>[];
  poolByReport: Record<string, number>;
};

// reports は createdAt 降順、articles も createdAt 降順で作ってある（build_snapshot.ts）
const S = snap as unknown as SnapshotFile;

/** スナップショットの元になったデータの日付（読者に「いつ時点か」を示すのに使う） */
export const SNAPSHOT_DATA_DATE = S.dataDate;
/** 収録している最新の朝刊の日付 */
export const SNAPSHOT_LATEST_REPORT_DATE = S.reports.find((r) => r.type === 'daily')?.reportDate ?? null;
/** 本番DBにあった記事の総数（載せているのは最新1,500件だけ） */
export const SNAPSHOT_ARTICLE_TOTAL = S.articleCount;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export function snapshotReports(limit: number, contentChars: number): SnapshotReport[] {
  const lim = clamp(limit, 1, 1000);
  return S.reports.slice(0, lim).map((r) => ({
    ...r,
    content: contentChars > 0 ? r.content.slice(0, contentChars) : r.content,
  }));
}

export function snapshotReportById(id: number): SnapshotReport | null {
  return S.reports.find((r) => r.id === id) ?? null;
}

export function snapshotAdjacentReports(type: string, reportDate: string) {
  if (!['daily', 'weekly', 'monthly'].includes(type)) return { prev: null, next: null };
  const same = S.reports.filter((r) => r.type === type && r.reportDate);
  const older = same
    .filter((r) => String(r.reportDate) < reportDate)
    .sort((a, b) => String(b.reportDate).localeCompare(String(a.reportDate)))[0];
  const newer = same
    .filter((r) => String(r.reportDate) > reportDate)
    .sort((a, b) => String(a.reportDate).localeCompare(String(b.reportDate)))[0];
  return {
    prev: older ? { id: older.id, reportDate: String(older.reportDate) } : null,
    next: newer ? { id: newer.id, reportDate: String(newer.reportDate) } : null,
  };
}

export function snapshotRecentDigests(limit: number, excludeId?: number) {
  const lim = clamp(limit, 1, 60);
  return S.reports
    .filter((r) => r.type === 'daily' && r.id !== excludeId)
    .slice(0, lim)
    .map((r) => ({ id: r.id, type: r.type, reportDate: r.reportDate }));
}

/** トップの「今朝の朝刊」。collectedFrom は生成時に数えてある（COUNT(*) を投げない） */
export function snapshotLandingDigest() {
  const latest = S.reports.find((r) => r.type === 'daily');
  if (!latest?.content) return null;
  return {
    id: latest.id,
    reportDate: latest.reportDate,
    content: latest.content,
    collectedFrom: S.poolByReport[String(latest.id)] ?? 0,
  };
}

export function snapshotArticles(limit: number, offset = 0): Record<string, unknown>[] {
  const lim = clamp(limit, 1, 200);
  const off = Math.max(offset, 0);
  return S.articles.slice(off, off + lim);
}

export function snapshotArticleById(id: number): Record<string, unknown> | null {
  return S.articles.find((a) => Number(a.id) === id) ?? null;
}

/** 記事一覧の「全n件」。スナップショットに載っているのは最新1,500件だけなので、そちらを返す
 *  （総数を出すと「もっと読む」が空振りする） */
export function snapshotArticleCount(): number {
  return S.articles.length;
}

/**
 * 延命中の簡易検索。載っている最新1,500件の題・和題・要約・タグを**部分一致**で拾う。
 *
 * ⚠ 本来の検索は kuromoji の形態素解析＋BM25＋ベクトル＋GraphRAG の3レーン（[[search-overhaul]]）。
 *   それらは索引がDBにあるので延命中は引けない。ここは代役であって同じものではない。
 * ⚠ **黙って0件を返さない**ことがこの関数の目的。分岐が無いと `searchArticles` が BLOCKED で
 *   例外→catch→`[]` となり、`isDbReachable()` は延命中 true を返すので、画面には
 *   「見つかりませんでした」とだけ出る＝検索が動いているように見えて何も出ない状態になる。
 *
 * 並べ替えは「題に入っている > 要約に入っている」→ 同点なら重要度→新しい順。
 * 日本語なので単語境界は使えない。空白で切って**全語を含む**ものだけ通す（AND）。
 */
export function snapshotSearch(query: string, limit: number): Record<string, unknown>[] {
  const terms = query.toLowerCase().split(/[\s　]+/).filter((t) => t.length > 0).slice(0, 6);
  if (!terms.length) return [];
  const scored: { a: Record<string, unknown>; s: number }[] = [];
  for (const a of S.articles) {
    const title = `${a.title ?? ''} ${a.titleJa ?? ''}`.toLowerCase();
    const body = `${a.summary ?? ''} ${a.tags ?? ''}`.toLowerCase();
    if (!terms.every((t) => title.includes(t) || body.includes(t))) continue;
    const hitTitle = terms.filter((t) => title.includes(t)).length;
    scored.push({ a, s: hitTitle * 1000 + Number(a.importanceScore ?? 0) });
  }
  return scored.sort((x, y) => y.s - x.s).slice(0, clamp(limit, 1, 100)).map((x) => x.a);
}
