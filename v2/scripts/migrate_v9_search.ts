/**
 * v9(その1): 公開検索の作り直し — 列と語彙テーブルだけを用意する。
 *
 * 既存の collected_fts(trigram) は RAG(retrieval.ts) 用なのでそのまま残す。公開検索は別系統:
 *   - collected_data.search_tokens : kuromojiで形態素解析した索引語（空白区切り）。パイプラインが書く。
 *   - search_vocab                 : kuromoji由来の語彙。実行時のクエリ分割（最長一致）に使う。
 *
 * ⚠ FTS5(search_fts)とトリガは **このスクリプトでは作らない**。
 *   外部コンテンツFTS5の索引は作成直後は空なので、既存行を UPDATE するとトリガの 'delete' が
 *   「索引に無い行の削除」になり SQLITE_CORRUPT を返す（2026-07-15に本番で踏んだ）。
 *   正しい順序は 列を作る → 列を埋める → 索引をrebuild → トリガを張る。
 *   索引とトリガは search_tokens を埋めた後に scripts/migrate_v9b_fts.ts で作ること。
 *
 * 手順:
 *   1. npx tsx scripts/migrate_v9_search.ts        (このスクリプト)
 *   2. PIPELINE_MODE=search npx tsx daily_pipeline.ts   (search_tokens と search_vocab を埋める)
 *   3. npx tsx scripts/migrate_v9b_fts.ts          (FTS5索引を作って rebuild → トリガ)
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

const statements = [
  // 壊れた順序で作ってしまった索引・トリガがあれば先に消す（再実行の安全弁）
  `DROP TRIGGER IF EXISTS search_fts_ai`,
  `DROP TRIGGER IF EXISTS search_fts_au`,
  `DROP TRIGGER IF EXISTS search_fts_ad`,
  `DROP TABLE IF EXISTS search_fts`,

  `ALTER TABLE collected_data ADD COLUMN search_tokens TEXT`,
  `CREATE TABLE IF NOT EXISTS search_vocab (
     term TEXT PRIMARY KEY,
     df INTEGER NOT NULL DEFAULT 0
   )`,
];

async function main() {
  for (const stmt of statements) {
    try {
      await client.execute(stmt);
      console.log('OK  :', stmt.split('\n')[0].slice(0, 72).trim());
    } catch (e: any) {
      console.log('SKIP:', e.message.slice(0, 90)); // duplicate column 等は再実行時の正常系
    }
  }
  const cols = await client.execute(`PRAGMA table_info(collected_data)`);
  const hasCol = cols.rows.some((r: any) => r.name === 'search_tokens');
  const filled = await client.execute(`SELECT count(*) c FROM collected_data WHERE search_tokens IS NOT NULL`);
  console.log(`\nsearch_tokens列: ${hasCol ? 'あり' : 'なし'} / 充填済み: ${(filled.rows[0] as any).c}件`);
  console.log('次: PIPELINE_MODE=search npx tsx daily_pipeline.ts → その後 scripts/migrate_v9b_fts.ts');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
