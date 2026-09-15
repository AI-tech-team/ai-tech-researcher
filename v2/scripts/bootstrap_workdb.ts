/**
 * 延命用のローカル作業DB（work.db）を、週次バックアップから組み立てる。
 *
 * 背景（2026-09-15）: Turso Free の読み取り枠を使い切って `BLOCKED`。リセットはカレンダー月なので
 * 10月1日まで読めない。サイトは静的スナップショットで延命しているが（[[SNAPSHOT_MODE]]）、
 * **朝刊の発行は収集もレポート生成もDB読み取りに依存する**ので止まったままだった。
 * → GitHub Actions の中に SQLite を1つ立てて、そこでパイプラインを回す。
 *
 * これが成立する根拠（2026-09-15 実測）:
 *   - `file:` のローカルlibSQLで **libsql_vector_idx / vector32 / vector_distance_cos /
 *     vector_top_k / FTS5(trigram) / bm25() が全部動く**
 *   - DB接続は `src/db/index.ts` も `daily_pipeline.ts` も `process.env.TURSO_DATABASE_URL` を
 *     見ているだけ ＝ **接続先を差し替えるだけでコード変更は要らない**
 *   - `PIPELINE_MODE=collect` と `report` は埋め込み・知識抽出・チャンクを呼ばない
 *     ＝ 想定外のGemini課金が起きない
 *
 * ⚠ バックアップには `raw_content` / `embedding` / `content_chunks` / users系が**入っていない**
 *   （第三条・PII）。したがって work.db でも:
 *     - 本文抽出の結果は空（朝刊は summary から作るので出る）
 *     - ベクトルが無いので重複排除(story)が効かない＝同じ話題が複数載りうる
 *     - 配信先はDBから取れない → env `OFFLINE_RECIPIENTS` で渡す
 *
 * 使い方:
 *   npx tsx scripts/bootstrap_workdb.ts                       # 最新の backups/backup_*.json から
 *   npx tsx scripts/bootstrap_workdb.ts backups/backup_2026-09-13.json
 *   WORK_DB=./.work.db npx tsx scripts/bootstrap_workdb.ts    # 出力先を変える
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';

// ⚠ 相対パスで渡すこと。日本語を含む絶対パスを file: に渡すと libsql ネイティブが
//   エラーも出さずプロセスごと落ちる（2026-09-15 にこの環境で踏んだ）。
const WORK_DB = process.env.WORK_DB ?? './.work.db';
const URL = 'file:' + (WORK_DB.startsWith('./') ? WORK_DB : './' + WORK_DB);

function latestBackup(): string {
  const dir = path.join(process.cwd(), 'backups');
  const files = fs.readdirSync(dir).filter((f) => /^backup_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('backups/backup_*.json が無い');
  return path.join(dir, files[files.length - 1]);
}

// 生SQLで作る分（drizzle のスキーマには無いもの）。既存の migrate スクリプトから写した。
const EXTRA_DDL = [
  // ⚠ まず Drizzle スキーマ外の列を足す。`embedding`(F32_BLOB) と `search_tokens` は
  //   「select時に巨大blobを引かないため」意図的にスキーマ外にしてある（src/db/schema.ts:62-63）ので、
  //   drizzle-kit push では作られない。これが無いとFTS5のトリガが
  //   `no such column: new.search_tokens` で落ちる（2026-09-15 に踏んだ）。
  //   ADD COLUMN に IF NOT EXISTS は無いので、既にあるときは下の catch で握る。
  `ALTER TABLE collected_data ADD COLUMN embedding F32_BLOB(768)`,
  `ALTER TABLE collected_data ADD COLUMN search_tokens TEXT`,
  // ベクトル索引（migrate_v3_vectors.ts）。embedding はバックアップに無いので中身は空だが、
  // 収集中に vector_top_k を引く経路があっても落ちないように先に作っておく
  `CREATE INDEX IF NOT EXISTS collected_embedding_idx ON collected_data(libsql_vector_idx(embedding, 'metric=cosine'))`,
  // 公開検索のFTS5とトリガ（migrate_v9b_fts.ts）。延命中は検索を止めているが、
  // トリガが無い状態で収集すると索引と実データがズレるので、作るなら最初に作る
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(search_tokens, content='', tokenize='unicode61')`,
  `CREATE TRIGGER IF NOT EXISTS search_fts_ai AFTER INSERT ON collected_data BEGIN
     INSERT INTO search_fts(rowid, search_tokens) VALUES (new.id, new.search_tokens);
   END`,
  `CREATE TRIGGER IF NOT EXISTS search_fts_ad AFTER DELETE ON collected_data BEGIN
     INSERT INTO search_fts(search_fts, rowid, search_tokens) VALUES ('delete', old.id, old.search_tokens);
   END`,
  // 本番に入れてある索引（2026-09-15 の枠切れ是正・migrate_2026_09_15_indexes.ts）。
  // ローカルでも同じ計画で走らせて、本番との差で挙動が変わらないようにする
  `CREATE INDEX IF NOT EXISTS collected_created_idx ON collected_data (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_collected_importance_created ON collected_data (importance_score DESC, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS collected_source_idx ON collected_data (source_id)`,
  `CREATE INDEX IF NOT EXISTS entities_mention_idx ON entities (mention_count DESC)`,
  `CREATE INDEX IF NOT EXISTS entities_lower_name_idx ON entities (LOWER(canonical_name))`,
  `CREATE INDEX IF NOT EXISTS relations_object_idx ON relations (object_name, status)`,
  `CREATE INDEX IF NOT EXISTS benchmarks_entity_name_idx ON benchmarks (entity_name)`,
  `CREATE INDEX IF NOT EXISTS reports_created_idx ON reports (created_at DESC)`,
];

// 投入する表と、その順番（FK: collected_data.source_id → sources.id）。
// ⚠ 朝刊に要るのはこの4つだけ。users/user_profiles はバックアップに無い（PII）ので空のまま。
const TABLES: { key: string; table: any; label: string }[] = [
  { key: 'sources', table: schema.sources, label: 'sources' },
  { key: 'collectedData', table: schema.collectedData, label: 'collected_data' },
  { key: 'reports', table: schema.reports, label: 'reports' },
  { key: 'pipelineLogs', table: schema.pipelineLogs, label: 'pipeline_logs' },
];

async function main() {
  const src = process.argv[2] ? path.resolve(process.argv[2]) : latestBackup();
  console.log(`元データ: ${path.basename(src)}`);
  console.log(`作業DB  : ${URL}\n`);

  // 作り直し（冪等）。壊れた途中状態を引き継がない
  // ⚠ ここで fs.rmSync を使うと、この環境では**プロセスが exit 127 で即死する**（出力も残らない）。
  //   existsSync + unlinkSync なら動く。原因は未特定（OneDrive配下のロックと思われる）。
  for (const suffix of ['', '-shm', '-wal']) {
    const f = WORK_DB + suffix;
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 掴まれていても続行 */ }
  }

  // 1) スキーマ: drizzle のスキーマ定義をそのまま押し込む（DDLを二重管理しない）
  console.log('[1/3] スキーマを作成 (drizzle-kit push)');
  // ⚠ stdio を 'ignore' にすると drizzle-kit が stdin を待って**固まる**（この環境で踏んだ）。
  //   'inherit' で素通しにする。
  execFileSync('npx', ['drizzle-kit', 'push', '--dialect=sqlite', `--url=${URL}`, '--schema=./src/db/schema.ts', '--force'],
    { stdio: 'inherit', shell: process.platform === 'win32', timeout: 180_000 });

  const client = createClient({ url: URL });
  const db = drizzle(client, { schema });

  // 2) 生SQLの索引・FTS5
  console.log('[2/3] 索引とFTS5を作成');
  let made = 0;
  for (const stmt of EXTRA_DDL) {
    try { await client.execute(stmt); made++; }
    catch (e) { console.warn('  スキップ:', String((e as Error).message).slice(0, 90)); }
  }
  console.log(`      ${made}/${EXTRA_DDL.length} 件`);

  // 3) データ投入
  console.log('[3/3] バックアップから投入');
  const b = JSON.parse(fs.readFileSync(src, 'utf8'));
  for (const { key, table, label } of TABLES) {
    const rows = b[key] as Record<string, unknown>[] | undefined;
    if (!rows?.length) { console.log(`      ${label}: 0件（バックアップに無い）`); continue; }
    const t0 = Date.now();
    // 1000件ずつ。onConflictDoNothing で再実行しても壊れない
    for (let i = 0; i < rows.length; i += 1000) {
      await db.insert(table).values(rows.slice(i, i + 1000) as never).onConflictDoNothing();
    }
    console.log(`      ${label}: ${rows.length}件 (${Date.now() - t0}ms)`);
  }

  // 4) 既に公開済みの朝刊を取り戻す
  //   バックアップは週1回なので、そこから作り直すと**その後に発行した号が消える**。
  //   コミット済みのスナップショットには発行済みの号が全部入っているので、そこから補う。
  //   （Actions のキャッシュが飛んだときに、公開済みのアーカイブが欠けるのを防ぐ）
  const snapPath = path.join(process.cwd(), 'src', 'data', 'snapshot.json');
  if (fs.existsSync(snapPath)) {
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    const rows = (snap.reports ?? []) as Record<string, unknown>[];
    if (rows.length) {
      for (let i = 0; i < rows.length; i += 1000) {
        await db.insert(schema.reports).values(rows.slice(i, i + 1000) as never).onConflictDoNothing();
      }
      const [{ n }] = (await client.execute('SELECT COUNT(*) AS n FROM reports')).rows as unknown as { n: number }[];
      console.log(`      snapshot.json から reports を補填: 候補${rows.length}件 → 合計${n}件`);
    }
  }

  const size = (fs.statSync(WORK_DB).size / 1048576).toFixed(1);
  console.log(`\n完了: ${WORK_DB} (${size}MB)`);
  console.log('次: TURSO_DATABASE_URL=' + URL + ' PIPELINE_MODE=collect npx tsx daily_pipeline.ts');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
