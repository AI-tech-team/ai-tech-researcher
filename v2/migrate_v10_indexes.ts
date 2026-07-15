/**
 * v10 マイグレーション: ホーム読み込みのホットパス用インデックスを collected_data に追加。
 * 背景: getCoreData の主要クエリ（corpus/highlights/activity/outlets）が全走査(SCAN)＋一時B-treeソートに
 *       なっており、コーパス増加に比例して線形悪化していた（Phase0計測・EXPLAIN QUERY PLANで確認）。
 * 冪等: CREATE INDEX IF NOT EXISTS。ロールバックは下部の DROP INDEX を参照。
 *
 * 実行:
 *   ドライ（現状表示のみ・書込なし）:  ENV_FILE=.env.prod.local npx tsx migrate_v10_indexes.ts
 *   適用:                          ENV_FILE=.env.prod.local APPLY=1 npx tsx migrate_v10_indexes.ts
 *   （ENV_FILE 未指定なら .env.local＝dev）
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });
config({ path: '.env' });
config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

const INDEXES = [
  { name: 'idx_collected_created_at',        ddl: `CREATE INDEX IF NOT EXISTS idx_collected_created_at ON collected_data(created_at DESC)` },
  { name: 'idx_collected_importance_created', ddl: `CREATE INDEX IF NOT EXISTS idx_collected_importance_created ON collected_data(importance_score DESC, created_at DESC)` },
  { name: 'idx_collected_story_id',          ddl: `CREATE INDEX IF NOT EXISTS idx_collected_story_id ON collected_data(story_id)` },
];

async function listIdx() {
  const r = await client.execute(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='collected_data' ORDER BY name`);
  return (r.rows as any[]).map(x => String(x.name));
}

async function main() {
  const host = (process.env.TURSO_DATABASE_URL ?? '').replace(/^libsql:\/\//, '').split('.')[0];
  const apply = process.env.APPLY === '1';
  console.log(`ENV_FILE=${envFile}  接続先DB=${host}  モード=${apply ? 'APPLY(書込)' : 'DRY(読取のみ)'}`);
  const [{ c: rows }] = (await client.execute(`SELECT count(*) c FROM collected_data`)).rows as any[];
  console.log(`collected_data 行数=${rows}`);
  console.log(`\n現在のインデックス:`);
  for (const n of await listIdx()) console.log(`  - ${n}`);

  if (!apply) {
    console.log(`\n未作成なら追加される索引: ${INDEXES.map(i => i.name).filter(async () => true).join(', ')}`);
    console.log('DRYモード終了（何も書き込んでいない）。適用は APPLY=1 を付けて再実行。');
    return;
  }

  console.log('\n--- CREATE INDEX IF NOT EXISTS ---');
  for (const idx of INDEXES) { await client.execute(idx.ddl); console.log(`  ✓ ${idx.name}`); }
  console.log(`\n適用後のインデックス:`);
  for (const n of await listIdx()) console.log(`  - ${n}`);
  console.log('\n完了。');
}

// ロールバック（必要時のみ手動実行）:
//   DROP INDEX IF EXISTS idx_collected_created_at;
//   DROP INDEX IF EXISTS idx_collected_importance_created;
//   DROP INDEX IF EXISTS idx_collected_story_id;
main().catch(e => { console.error(e); process.exit(1); });
