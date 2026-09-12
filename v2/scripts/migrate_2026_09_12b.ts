/**
 * 2026-09-12(b) /category/* の索引。
 *
 * 症状: /category/LLM推論 の初回アクセスが 17〜21秒（7URL全部・4回再現。60秒空くだけで再発）。
 *
 * 原因: `getArticlesByCategory` は category で絞り importance_score DESC, created_at DESC で
 * 並べるが、collected_data には category の索引が無かった。実行計画は
 *   SCAN cd
 *   USE TEMP B-TREE FOR ORDER BY
 * ＝23,300行の全走査＋一時B-treeソート。本番DB単体で 13.8秒（LLM推論=6,697件）。
 * `cached(..., 300_000)` はプロセス内メモリなので、インスタンスが変わると効かない。
 *
 * 対処: (category, importance_score DESC, created_at DESC) の複合索引。
 * WHERE と ORDER BY を1本で賄えるので TEMP B-TREE も消える。
 *
 * 使い方（冪等）:
 *   npx tsx scripts/migrate_2026_09_12b.ts .env.local
 *   npx tsx scripts/migrate_2026_09_12b.ts .env.prod.write
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

const envPath = process.argv[2];
if (!envPath) {
  console.error('使い方: npx tsx scripts/migrate_2026_09_12b.ts <envファイル>');
  process.exit(1);
}
config({ path: envPath });

const url = process.env.TURSO_DATABASE_URL;
if (!url) { console.error('TURSO_DATABASE_URL が読めない'); process.exit(1); }
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const INDEXES: { name: string; sql: string; why: string }[] = [
  {
    name: 'collected_category_idx',
    sql: `CREATE INDEX IF NOT EXISTS collected_category_idx
            ON collected_data (category, importance_score DESC, created_at DESC)`,
    why: '/category/[name] の一覧（WHERE category + ORDER BY importance,created）',
  },
  {
    name: 'claims_entity_idx',
    sql: `CREATE INDEX IF NOT EXISTS claims_entity_idx ON claims (entity_id, status)`,
    why: '/topic/[name] のクレーム取得。claims は索引ゼロで SCAN だった',
  },
  {
    name: 'claims_subject_idx',
    sql: `CREATE INDEX IF NOT EXISTS claims_subject_idx ON claims (subject, status)`,
    why: '同上。entity 未登録時の名前一致フォールバック経路',
  },
  {
    name: 'claims_article_idx',
    sql: `CREATE INDEX IF NOT EXISTS claims_article_idx ON claims (article_id)`,
    why: 'ingestKnowledge の再抽出時 DELETE ... WHERE article_id=?（抽出が10→60本/日に増えるため）',
  },
];

async function main() {
  console.log(`対象DB: ${url!.replace(/^libsql:\/\//, '')}\n`);

  for (const ix of INDEXES) {
    const before = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='${ix.name}'`);
    if (before.rows.length > 0) {
      console.log(`  ${ix.name}: 既にある（スキップ）`);
      continue;
    }
    const t0 = Date.now();
    await client.execute(ix.sql);
    console.log(`  ${ix.name}: 作成 (${Date.now() - t0}ms) — ${ix.why}`);
  }

  console.log('\n=== 効果の確認 ===');
  const plan = await client.execute(`EXPLAIN QUERY PLAN
    SELECT cd.id FROM collected_data cd LEFT JOIN sources s ON cd.source_id = s.id
    WHERE cd.category = 'LLM推論'
    ORDER BY cd.importance_score DESC, cd.created_at DESC LIMIT 40`);
  for (const r of plan.rows) console.log(`  ${r.detail}`);

  for (const cat of ['LLM推論', 'エージェント', 'ハードウェア']) {
    const t0 = Date.now();
    const r = await client.execute({
      sql: `SELECT cd.id FROM collected_data cd LEFT JOIN sources s ON cd.source_id = s.id
            WHERE cd.category = ? ORDER BY cd.importance_score DESC, cd.created_at DESC LIMIT 40`,
      args: [cat],
    });
    console.log(`  ${cat}: ${Date.now() - t0}ms (${r.rows.length}件)`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
