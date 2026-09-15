/**
 * 2026-09-15 読み取り枠切れ（`BLOCKED: SQL read operations are forbidden`）の是正。
 *
 * 背景: Turso Free は月500M行読み取りで、超えると**クエリが失敗する**（従量課金にならない）。
 * リセットはカレンダー月なので、何もしなければ10月1日まで復旧しない。
 * 9/1〜9/14 で使い切った＝1日あたり約3,600万行を読んでいた計算。DBは全部で35,389行しかない
 * （backup_2026-09-13.json の実測）ので、件数ではなく**読み方**の問題。
 *
 * 測り方: 本番もdevも読めない（枠は組織単位で共有されている）ため、`drizzle-kit generate` で
 * 出したDDLとリポジトリ内の CREATE INDEX 全部をローカルSQLiteに再現し、EXPLAIN QUERY PLAN を
 * 当てて全表走査(SCAN)になるクエリを洗い出した。以下は「索引を足すとプランが変わる」ことを
 * その再現環境で確認済みのものだけ。
 *
 * ⚠ 書き込みはブロックされていない（dev で実測: SELECT は NG、CREATE TABLE/INSERT/CREATE INDEX/
 *   DROP は OK）。なので枠が戻る前でもこのマイグレーションは当てられる。
 *
 * 使い方（冪等）:
 *   npx tsx scripts/migrate_2026_09_15_indexes.ts .env.local
 *   npx tsx scripts/migrate_2026_09_15_indexes.ts .env.prod.write
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

const envPath = process.argv[2];
if (!envPath) {
  console.error('使い方: npx tsx scripts/migrate_2026_09_15_indexes.ts <envファイル>');
  process.exit(1);
}
config({ path: envPath });

const url = process.env.TURSO_DATABASE_URL;
if (!url) { console.error('TURSO_DATABASE_URL が読めない'); process.exit(1); }
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const INDEXES: { name: string; sql: string; why: string }[] = [
  {
    name: 'entities_lower_name_idx',
    sql: `CREATE INDEX IF NOT EXISTS entities_lower_name_idx ON entities (LOWER(canonical_name))`,
    why: 'middleware:95 と actions:841 の LOWER(canonical_name)=?。関数適用で索引が効かず SCAN entities（1,846行）'
       + 'だった。middleware は /topic/:name の**全アクセス**で走り、ISRでCDNヒットしても手前で必ず動く',
  },
  {
    name: 'relations_object_idx',
    sql: `CREATE INDEX IF NOT EXISTS relations_object_idx ON relations (object_name, status)`,
    why: 'actions:895 の object_name=?。既存の relations_edge_uniq は (subject_name,…) で先頭列が違うため'
       + '効かず SCAN r だった。トピック一覧の名前集合づくり（UNION側）も COVERING INDEX になる',
  },
  {
    name: 'benchmarks_entity_name_idx',
    sql: `CREATE INDEX IF NOT EXISTS benchmarks_entity_name_idx ON benchmarks (entity_name)`,
    why: 'actions:865 の (entity_id=? OR entity_name=?)。片側に索引が無いと OR 全体が SCAN に落ちる。'
       + '足すと MULTI-INDEX OR になる（claims 側は既にこの形で直っていた）',
  },
  {
    name: 'collected_source_idx',
    sql: `CREATE INDEX IF NOT EXISTS collected_source_idx ON collected_data (source_id)`,
    why: 'daily_pipeline:1310 の reportSilentSources（sources LEFT JOIN collected_data GROUP BY）。'
       + '索引が無いのでSQLiteが毎回 AUTOMATIC COVERING INDEX を作っていた＝23,649行を読んで一時索引を'
       + '構築し直す。しかもこれは**収集ラン6回すべて**で走る',
  },
];

async function main() {
  console.log(`対象DB: ${url}\n`);
  for (const ix of INDEXES) {
    const t0 = Date.now();
    try {
      await client.execute(ix.sql);
      console.log(`✅ ${ix.name}: 作成 (${Date.now() - t0}ms)`);
      console.log(`     ${ix.why}\n`);
    } catch (e) {
      console.log(`❌ ${ix.name}: ${(e as Error).message.slice(0, 160)}\n`);
    }
  }

  // 効果の確認は EXPLAIN QUERY PLAN ＝読み取りなので、枠が切れている間は実行できない。
  // 枠が戻ったらこのブロックが動いて、SEARCH に変わっていることを確かめる。
  console.log('=== 効果の確認（読み取りが戻っていれば表示される）===');
  const checks: [string, string][] = [
    ['middleware /topic 存在確認', `SELECT 1 FROM entities WHERE LOWER(canonical_name) = 'openai' LIMIT 1`],
    ['relations 入', `SELECT relation_type FROM relations WHERE object_name = 'OpenAI' AND status != 'stale' LIMIT 60`],
    ['benchmarks の OR', `SELECT benchmark_name FROM benchmarks WHERE (entity_id = 1 OR entity_name = 'OpenAI') LIMIT 40`],
    ['silentSources', `SELECT s.id, COUNT(c.id) AS n FROM sources s LEFT JOIN collected_data c ON c.source_id = s.id GROUP BY s.id LIMIT 20`],
  ];
  for (const [label, sql] of checks) {
    try {
      const plan = await client.execute(`EXPLAIN QUERY PLAN ${sql}`);
      const details = plan.rows.map((r) => String(r.detail));
      const bad = details.some((d) => d.startsWith('SCAN') && !/USING COVERING INDEX/.test(d));
      console.log(`  ${bad ? '⚠ まだSCAN' : '✅ SEARCH'} ${label}`);
      for (const d of details) console.log(`      ${d}`);
    } catch (e) {
      console.log(`  (読めない: ${(e as Error).message.slice(0, 60)}) ${label}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
