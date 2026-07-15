/**
 * v9(その2): search_tokens を埋めた「後」に、FTS5索引と同期トリガを作る。
 *
 * ⚠ content='' の独立FTSにする（外部コンテンツFTSにしない）。
 *   外部コンテンツ（content='collected_data'）だと bm25() の計算のたびに親テーブルを引き直すため、
 *   "ai" のような高頻度語で 3,000ms超に膨れる。rowid を直に持つ独立FTSなら同じクエリが 57ms（本番実測・2026-07-15）。
 *   その代わり索引本体はアプリ/トリガが明示的に書く（自動同期はされない）。
 *
 * ⚠ 順序も重要（同日に SQLITE_CORRUPT を踏んだ教訓）:
 *   索引は CREATE 直後は空。トリガを先に張った状態で既存行を UPDATE すると、
 *   トリガの 'delete' が「索引に無い行の削除」になり corrupt する。
 *   → 列を埋める → 既存 search_tokens を一括 INSERT → それからトリガを張る。
 *
 * 実行: v2/ で `npx tsx scripts/migrate_v9b_fts.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  const filledRow = (await client.execute(`SELECT count(*) c FROM collected_data WHERE search_tokens IS NOT NULL`)).rows[0] as any;
  if (Number(filledRow.c) === 0) {
    console.error('search_tokens が空。先に PIPELINE_MODE=search npx tsx daily_pipeline.ts を実行すること。');
    process.exit(1);
  }
  console.log(`search_tokens 充填済み: ${filledRow.c}件`);

  // 作り直し（冪等）。トリガを先に落としてから索引を作る
  for (const stmt of [
    `DROP TRIGGER IF EXISTS search_fts_ai`,
    `DROP TRIGGER IF EXISTS search_fts_au`,
    `DROP TRIGGER IF EXISTS search_fts_ad`,
    `DROP TABLE IF EXISTS search_fts`,
    // 独立FTS（rowid = collected_data.id）。bm25()が親テーブルを触らないので高頻度語でも速い
    `CREATE VIRTUAL TABLE search_fts USING fts5(search_tokens, content='', tokenize='unicode61')`,
  ]) {
    await client.execute(stmt);
    console.log('OK  :', stmt.split('\n')[0].slice(0, 72).trim());
  }

  // 既存データを索引へ流し込む（rebuildは外部コンテンツ専用なので使えない＝手で INSERT する）
  const rows = (await client.execute(`SELECT id, search_tokens FROM collected_data WHERE search_tokens IS NOT NULL`)).rows;
  for (let i = 0; i < rows.length; i += 400) {
    await client.batch(rows.slice(i, i + 400).map(r => ({
      sql: `INSERT INTO search_fts(rowid, search_tokens) VALUES (?, ?)`,
      args: [Number(r.id), String(r.search_tokens ?? '')],
    })), 'write');
  }
  console.log(`OK  : 索引へ ${rows.length}件を投入`);

  // 同期トリガ。search_tokens を書き換えれば索引も必ず追従する（アプリの書き忘れで検索から記事が消えない）
  for (const stmt of [
    `CREATE TRIGGER search_fts_ai AFTER INSERT ON collected_data BEGIN
       INSERT INTO search_fts(rowid, search_tokens) VALUES (new.id, new.search_tokens);
     END`,
    `CREATE TRIGGER search_fts_ad AFTER DELETE ON collected_data BEGIN
       INSERT INTO search_fts(search_fts, rowid, search_tokens) VALUES ('delete', old.id, old.search_tokens);
     END`,
    `CREATE TRIGGER search_fts_au AFTER UPDATE ON collected_data BEGIN
       INSERT INTO search_fts(search_fts, rowid, search_tokens) VALUES ('delete', old.id, old.search_tokens);
       INSERT INTO search_fts(rowid, search_tokens) VALUES (new.id, new.search_tokens);
     END`,
  ]) {
    await client.execute(stmt);
    console.log('OK  :', stmt.split('\n')[0].slice(0, 60).trim());
  }

  const hit = await client.execute(`SELECT rowid FROM search_fts WHERE search_fts MATCH '"推論"' LIMIT 5`);
  const ok = await client.execute(`INSERT INTO search_fts(search_fts) VALUES('integrity-check')`).then(() => 'ok').catch((e: any) => e.message.slice(0, 60));
  console.log(`\n「推論」ヒット: ${hit.rows.length}件 / FTS整合性: ${ok}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
