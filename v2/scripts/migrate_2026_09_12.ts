/**
 * 2026-09-12 のスキーマ変更を適用する。
 *
 * push の「前」に本番へ当てること。未適用のまま push すると、全カラムselect（週次/月次/backup）や
 * knowledgeExtractedAt の UPDATE が本番だけ SQL エラーになる（ローカルは通るので気づけない）。
 * → CLAUDE.md 第四条 / [[reference-dev-env]]
 *
 * 使い方:
 *   npx tsx scripts/migrate_2026_09_12.ts .env.local        # dev
 *   npx tsx scripts/migrate_2026_09_12.ts .env.prod.write   # 本番
 *
 * 冪等。2回流しても落ちない。
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

const envPath = process.argv[2];
if (!envPath) {
  console.error('使い方: npx tsx scripts/migrate_2026_09_12.ts <envファイル>');
  process.exit(1);
}
config({ path: envPath });

const url = process.env.TURSO_DATABASE_URL;
if (!url) { console.error('TURSO_DATABASE_URL が読めない'); process.exit(1); }
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  console.log(`対象DB: ${url!.replace(/^libsql:\/\//, '')}\n`);

  // ① 知識抽出の実施記録。これが無いと「まだ抽出していない記事」を選べず、1日窓に頼るしかない。
  const cols = await client.execute(`PRAGMA table_info(collected_data)`);
  const has = (n: string) => cols.rows.some(r => String(r.name) === n);
  if (has('knowledge_extracted_at')) {
    console.log('① collected_data.knowledge_extracted_at: 既にある（スキップ）');
  } else {
    await client.execute(`ALTER TABLE collected_data ADD COLUMN knowledge_extracted_at TEXT`);
    console.log('① collected_data.knowledge_extracted_at を追加');
  }

  // 既に抽出済みの記事を実施済みにする。これをやらないと、抽出済み9,000件超を
  // もう一度LLMに通すことになる（重複課金かつ滞留が減らない）。
  const back = await client.execute(`
    UPDATE collected_data SET knowledge_extracted_at = CURRENT_TIMESTAMP
    WHERE knowledge_extracted_at IS NULL AND (
      EXISTS (SELECT 1 FROM claims      x WHERE x.article_id = collected_data.id)
      OR EXISTS (SELECT 1 FROM benchmarks x WHERE x.article_id = collected_data.id)
      OR EXISTS (SELECT 1 FROM relations  x WHERE x.article_id = collected_data.id))`);
  console.log(`   既に抽出済みの ${back.rowsAffected} 件を実施済みとして記録`);

  // ② sources.value の UNIQUE。これが無いせいで3箇所の .onConflictDoNothing() が空振りし、
  // 同じURLが何行でも入っていた（itmedia topstory が33行）。
  // 重複が残ったままだと UNIQUE index は張れないので、先に最小id以外を停止して潰す。
  const idx = await client.execute(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sources'`);
  if (idx.rows.some(r => String(r.name) === 'sources_value_unique')) {
    console.log('② sources.value の UNIQUE: 既にある（スキップ）');
    return;
  }

  const dups = await client.execute(`
    SELECT value, COUNT(*) n FROM sources GROUP BY value HAVING COUNT(*) > 1`);
  if (dups.rows.length > 0) {
    console.log(`② 重複 ${dups.rows.length} 種を統合する:`);
    for (const d of dups.rows) console.log(`     ×${d.n}  ${d.value}`);
    // 実データ（last_hit_at / score）は最小idの行に寄せてから、余りを削除する。
    await client.execute(`
      UPDATE sources SET
        score = COALESCE((SELECT MAX(s2.score) FROM sources s2 WHERE s2.value = sources.value), score),
        last_hit_at = COALESCE((SELECT MAX(s2.last_hit_at) FROM sources s2 WHERE s2.value = sources.value), last_hit_at)
      WHERE id IN (SELECT MIN(id) FROM sources GROUP BY value)`);
    // sources.id を参照している表は collected_data と adoption_logs の2つ（PRAGMA foreign_key_list で確認）。
    // 消える行を指したままだと DELETE が FOREIGN KEY constraint failed で落ちるので、両方付け替える。
    for (const tbl of ['collected_data', 'adoption_logs']) {
      const re = await client.execute(`
        UPDATE ${tbl} SET source_id = (
          SELECT MIN(s2.id) FROM sources s2
          WHERE s2.value = (SELECT s3.value FROM sources s3 WHERE s3.id = ${tbl}.source_id))
        WHERE source_id IS NOT NULL
          AND source_id NOT IN (SELECT MIN(id) FROM sources GROUP BY value)
          -- 既に存在しない source_id を指している行（孤児）は触らない。
          -- 無条件に更新すると付け替え先が見つからず source_id が NULL に書き換わる＝黙ったデータ欠損。
          AND EXISTS (SELECT 1 FROM sources s4 WHERE s4.id = ${tbl}.source_id)`);
      console.log(`     ${tbl} ${re.rowsAffected} 行の source_id を残す行へ付け替え`);
    }
    const del = await client.execute(`
      DELETE FROM sources WHERE id NOT IN (SELECT MIN(id) FROM sources GROUP BY value)`);
    console.log(`     重複 ${del.rowsAffected} 行を削除`);
  }

  await client.execute(`CREATE UNIQUE INDEX sources_value_unique ON sources(value)`);
  console.log('② sources.value に UNIQUE index を作成');

  const after = await client.execute(`SELECT COUNT(*) n FROM sources`);
  console.log(`\n完了。sources 総数 ${after.rows[0].n} 行`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
