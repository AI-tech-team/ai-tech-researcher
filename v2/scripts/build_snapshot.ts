/**
 * 「読み取りが出来なくても配れる静的スナップショット」を作る。
 *
 * 背景（2026-09-15）: Turso Free の月500M行読み取りを9/14に使い切り、`BLOCKED` で
 * **読み取りが全部落ちた**。リセットはカレンダー月なので10月1日まで戻らない。
 * 書き込みは通る（dev で実測）が、読めない以上サイトは何も表示できない。
 * → 公開面のデータ源を、DBではなくこのスナップショットにする（`SNAPSHOT_MODE=1`）。
 *
 * 2つの入力:
 *   npx tsx scripts/build_snapshot.ts                  # backups/backup_*.json の最新から（初回）
 *   npx tsx scripts/build_snapshot.ts --from-db        # 作業DB（work.db）から（毎朝の更新）
 *
 * `--from-db` は `TURSO_DATABASE_URL` を見る。延命中は GitHub Actions の中で
 * `file:./.work.db` を指す（scripts/bootstrap_workdb.ts が組み立てたもの）。
 *
 * 出力: src/data/snapshot.json（本体）と src/data/snapshot-ids.json（middleware用の軽量版）
 *   ⚠ 抽出本文(raw_content)は**絶対に含めない**（第三条・公衆送信）。列を明示して select している。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const OUT = path.join(process.cwd(), 'src', 'data', 'snapshot.json');
const IDS_OUT = path.join(process.cwd(), 'src', 'data', 'snapshot-ids.json');

/** 記事は最新この件数だけ載せる。1,500件で約4MB＝直近1週間強（流入は実測221件/日）。
 *  これより古い記事の個別ページは、延命中は404になる（一覧・朝刊からは辿れない範囲）。 */
const ARTICLE_LIMIT = 1500;

/** 公開面に出る種別だけ。briefing/corpus_health/learning_recap/cross_insight は内部用なので載せない
 *  （getReportsData のホワイトリストと揃える）。 */
const PUBLIC_REPORT_TYPES = new Set(['daily', 'weekly', 'monthly']);

type Row = Record<string, unknown>;
type Source = {
  date: string; label: string; sources: Row[]; collectedData: Row[]; reports: Row[];
  /** 全記事の created_at（降順）。載せるのは ARTICLE_LIMIT 件だけだが、
   *  「全n件」表示と poolByReport の母数には**全件**が要る。 */
  allCreatedAt: string[];
};

function latestBackup(): string {
  const dir = path.join(process.cwd(), 'backups');
  const files = fs.readdirSync(dir).filter((f) => /^backup_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('backups/backup_*.json が無い');
  return path.join(dir, files[files.length - 1]);
}

function fromBackup(file: string): Source {
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  const collectedData: Row[] = b.collectedData ?? [];
  return {
    date: String(b.date ?? ''),
    label: path.basename(file),
    sources: b.sources ?? [],
    collectedData,
    reports: b.reports ?? [],
    allCreatedAt: collectedData.map((a) => String(a.createdAt ?? '')).sort().reverse(),
  };
}

/** 作業DBから直接読む。⚠ 列は明示する（`SELECT *` にすると raw_content と embedding まで載る）。 */
async function fromDb(): Promise<Source> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('--from-db には TURSO_DATABASE_URL が要る');
  const c = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const rows = async (sql: string) => (await c.execute(sql)).rows as unknown as Row[];
  // キー名はバックアップ（drizzle の select 結果＝キャメル）に合わせる
  const collectedData = await rows(`
    SELECT id, source_id AS sourceId, title, title_ja AS titleJa, url, summary, category,
           importance_score AS importanceScore, normalized_importance_score AS normalizedImportanceScore,
           tags, key_points AS keyPoints, why_matters AS whyMatters, extract_error AS extractError,
           published_at AS publishedAt, created_at AS createdAt,
           story_id AS storyId, story_count AS storyCount
      FROM collected_data ORDER BY created_at DESC LIMIT ${ARTICLE_LIMIT}`);
  // 母数用に created_at だけ全件引く（ローカルSQLiteなので全件でも安い）
  const stamps = await rows('SELECT created_at AS c FROM collected_data ORDER BY created_at DESC');
  return {
    date: new Date().toISOString().slice(0, 10),
    label: url,
    sources: await rows('SELECT id, value, type FROM sources'),
    collectedData,
    reports: await rows(`SELECT id, type, content, report_date AS reportDate, created_at AS createdAt FROM reports`),
    allCreatedAt: stamps.map((r) => String(r.c ?? '')),
  };
}

async function main() {
  const useDb = process.argv.includes('--from-db');
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const src = useDb ? await fromDb() : fromBackup(fileArg ? path.resolve(fileArg) : latestBackup());
  console.log(`元データ: ${src.label}`);

  const sourceById = new Map<number, { value: string; type: string }>();
  for (const s of src.sources) sourceById.set(Number(s.id), { value: String(s.value ?? ''), type: String(s.type ?? '') });

  // --- レポート（朝刊） ---
  const reports = src.reports
    .filter((r) => PUBLIC_REPORT_TYPES.has(String(r.type)))
    // 本文が空の号は公開面に出さない（getReportsData / getRecentDigests / getAdjacentReports と同じ条件）
    .filter((r) => String(r.content ?? '').trim().length > 0)
    .map((r) => ({
      // 列の null 許容は schema.ts に合わせる（reportDate は notNull / createdAt は nullable）
      id: Number(r.id), type: String(r.type), reportDate: String(r.reportDate ?? ''),
      createdAt: (r.createdAt ?? null) as string | null, content: String(r.content ?? ''),
    }))
    .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));

  // --- 記事 ---
  const all = src.collectedData.slice()
    .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
  const articles = all.slice(0, ARTICLE_LIMIT).map((a) => {
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
      // ⚠ hasBody は rawContent の有無から作る列だが、スナップショットは rawContent を持たない
      //   （第三条）。null にして「理由は分からない」に倒す（嘘の理由を出さない）。
      hasBody: null,
      isFavorited: false, isReadLater: false, isRead: false,
    };
  });

  // --- getLandingDigest の「何本から選んだか」を事前計算する ---
  // 本来は COUNT(*) を毎回投げているが、延命中は読めないのでここで数えておく。
  // 母集団 = 前回の朝刊から今回の朝刊までに収集された記事（actions.ts の定義と同じ）。
  const dailies = reports.filter((r) => r.type === 'daily');
  const poolByReport: Record<string, number> = {};
  for (let i = 0; i < dailies.length; i++) {
    const until = String(dailies[i].createdAt ?? '');
    const prev = dailies[i + 1];
    const since = prev?.createdAt
      ? String(prev.createdAt)
      : new Date(new Date(until.replace(' ', 'T') + 'Z').getTime() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    let n = 0;
    for (const c of src.allCreatedAt) {
      if (c >= since && c <= until) n++;
    }
    poolByReport[String(dailies[i].id)] = n;
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    sourceBackup: src.label,
    dataDate: src.date,
    articleCount: src.allCreatedAt.length,   // 一覧の「全n件」表示用（載せているのは articles だけ）
    reports,
    articles,
    poolByReport,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snapshot));
  console.log(`出力: src/data/snapshot.json  ${(fs.statSync(OUT).size / 1048576).toFixed(2)}MB`);

  // middleware 用の軽量版。⚠ middleware に本体(数MB)を import してはいけない
  // （Edge のバンドル上限に当たる／全アクセスで読み込まれる）。id の配列だけにする。
  fs.writeFileSync(IDS_OUT, JSON.stringify({
    // 読者に「いつ時点か」を伝えるのにも使う（本体を読まずに済むよう、日付だけここにも置く）
    dataDate: snapshot.dataDate,
    latestReportDate: String(dailies[0]?.reportDate ?? ''),
    articles: articles.map((a) => a.id),
    reports: reports.map((r) => r.id),
  }));
  console.log(`出力: src/data/snapshot-ids.json  ${(fs.statSync(IDS_OUT).size / 1024).toFixed(0)}KB`);
  console.log(`  レポート ${reports.length}件（daily ${dailies.length} / 最新 ${dailies[0]?.reportDate ?? '-'}）`);
  console.log(`  記事 ${articles.length}件（全${src.allCreatedAt.length}件中） 最新 ${String(articles[0]?.createdAt ?? '-').slice(0, 16)}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
