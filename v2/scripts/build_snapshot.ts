/**
 * 週次バックアップから「読み取りが出来なくても配れる静的スナップショット」を作る。
 *
 * 背景（2026-09-15）: Turso Free の月500M行読み取りを9/14に使い切り、`BLOCKED` で
 * **読み取りが全部落ちた**。リセットはカレンダー月なので10月1日まで戻らない。
 * 書き込みは通る（dev で実測）が、読めない以上サイトは何も表示できない。
 * → 既にリポジトリにある週次バックアップを、そのまま公開面のデータ源にする。
 *
 * 使い方:
 *   npx tsx scripts/build_snapshot.ts                       # 最新の backups/backup_*.json を使う
 *   npx tsx scripts/build_snapshot.ts backups/backup_2026-09-13.json
 *
 * 出力: src/data/snapshot.json（コミットする）
 *   ⚠ raw_content はバックアップ自体に入っていない（第三条・公衆送信の回避）。
 *     つまりこのスナップショットにも抽出本文は含まれない＝公開してよい範囲しか持たない。
 */
import fs from 'node:fs';
import path from 'node:path';

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const OUT = path.join(process.cwd(), 'src', 'data', 'snapshot.json');

/** 記事は最新この件数だけ載せる。1,500件で約2.4MB＝直近1週間強（流入は実測221件/日）。
 *  これより古い記事の個別ページは、延命中は404になる（一覧・朝刊からは辿れない範囲）。 */
const ARTICLE_LIMIT = 1500;

/** 公開面に出る種別だけ。briefing/corpus_health/learning_recap/cross_insight は内部用なので載せない
 *  （getReportsData のホワイトリストと揃える）。 */
const PUBLIC_REPORT_TYPES = new Set(['daily', 'weekly', 'monthly']);

function latestBackup(): string {
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => /^backup_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('backups/backup_*.json が無い');
  return path.join(BACKUP_DIR, files[files.length - 1]);
}

const src = process.argv[2] ? path.resolve(process.argv[2]) : latestBackup();
console.log(`元データ: ${path.basename(src)}`);
const b = JSON.parse(fs.readFileSync(src, 'utf8'));

const sourceById = new Map<number, { value: string; type: string }>();
for (const s of b.sources ?? []) sourceById.set(Number(s.id), { value: String(s.value ?? ''), type: String(s.type ?? '') });

// --- レポート（朝刊） ---
const reports = (b.reports ?? [])
  .filter((r: Record<string, unknown>) => PUBLIC_REPORT_TYPES.has(String(r.type)))
  // 本文が空の号は公開面に出さない（getReportsData / getRecentDigests / getAdjacentReports と同じ条件）
  .filter((r: Record<string, unknown>) => String(r.content ?? '').trim().length > 0)
  .map((r: Record<string, unknown>) => ({
    // 列の null 許容は schema.ts に合わせる（reportDate は notNull / createdAt は nullable）
    id: Number(r.id), type: String(r.type), reportDate: String(r.reportDate ?? ''),
    createdAt: r.createdAt ?? null, content: String(r.content ?? ''),
  }))
  .sort((x: { createdAt: string }, y: { createdAt: string }) => String(y.createdAt).localeCompare(String(x.createdAt)));

// --- 記事 ---
const all = (b.collectedData ?? []).slice()
  .sort((x: Record<string, unknown>, y: Record<string, unknown>) => String(y.createdAt).localeCompare(String(x.createdAt)));
const articles = all.slice(0, ARTICLE_LIMIT).map((a: Record<string, unknown>) => {
  const s = sourceById.get(Number(a.sourceId));
  return {
    id: Number(a.id), title: a.title ?? null, titleJa: a.titleJa ?? null, url: a.url ?? null,
    summary: a.summary ?? null, category: a.category ?? null,
    importanceScore: a.importanceScore ?? null, normalizedImportanceScore: a.normalizedImportanceScore ?? null,
    tags: a.tags ?? null,                    // JSON文字列のまま（parseCollectedRows が解く）
    publishedAt: a.publishedAt ?? null, createdAt: a.createdAt ?? null,
    sourceValue: s?.value ?? null, sourceType: s?.type ?? null,
    storyId: a.storyId ?? null, storyCount: a.storyCount ?? null,
    extractError: a.extractError ?? null,
    // 記事ページの「要点」と「なぜ重要か」。keyPoints は JSON文字列のまま（getArticleById が解く）
    keyPoints: a.keyPoints ?? null, whyMatters: a.whyMatters ?? null,
    // ⚠ hasBody は rawContent の有無から作る列だが、バックアップに rawContent が無いので判定できない。
    //   null にして「理由は分からない」に倒す（嘘の理由を出さない）。
    hasBody: null,
    isFavorited: false, isReadLater: false, isRead: false,
  };
});

// --- getLandingDigest の「何本から選んだか」を事前計算する ---
// 本来は COUNT(*) を毎回投げているが、延命中は読めないのでここで数えておく。
// 母集団 = 前回の朝刊から今回の朝刊までに収集された記事（actions.ts:181 と同じ定義）。
const dailies = reports.filter((r: { type: string }) => r.type === 'daily');
const poolByReport: Record<string, number> = {};
for (let i = 0; i < dailies.length; i++) {
  const until = String(dailies[i].createdAt ?? '');
  const prev = dailies[i + 1];
  const since = prev?.createdAt
    ? String(prev.createdAt)
    : new Date(new Date(until.replace(' ', 'T') + 'Z').getTime() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  let n = 0;
  for (const a of all) {
    const c = String(a.createdAt ?? '');
    if (c >= since && c <= until) n++;
  }
  poolByReport[String(dailies[i].id)] = n;
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  sourceBackup: path.basename(src),
  dataDate: String(b.date ?? ''),
  articleCount: all.length,          // 一覧の「全n件」表示用（載せているのは articles だけ）
  reports,
  articles,
  poolByReport,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(snapshot));
const mb = (fs.statSync(OUT).size / 1048576).toFixed(2);
console.log(`出力: src/data/snapshot.json  ${mb}MB`);

// middleware 用の軽量版。⚠ middleware に本体(数MB)を import してはいけない
// （Edge のバンドル上限に当たる／全アクセスで読み込まれる）。id の配列だけにする。
const IDS_OUT = path.join(process.cwd(), 'src', 'data', 'snapshot-ids.json');
fs.writeFileSync(IDS_OUT, JSON.stringify({
  // 読者に「いつ時点か」を伝えるのにも使う（本体を読まずに済むよう、日付だけここにも置く）
  dataDate: snapshot.dataDate,
  latestReportDate: String(dailies[0]?.reportDate ?? ''),
  articles: articles.map((a: { id: number }) => a.id),
  reports: reports.map((r: { id: number }) => r.id),
}));
console.log(`出力: src/data/snapshot-ids.json  ${(fs.statSync(IDS_OUT).size / 1024).toFixed(0)}KB`);
console.log(`  レポート ${reports.length}件（daily ${dailies.length} / 最新 ${dailies[0]?.reportDate ?? '-'}）`);
console.log(`  記事 ${articles.length}件（全${all.length}件中） 最新 ${String(articles[0]?.createdAt ?? '-').slice(0, 16)}`);
