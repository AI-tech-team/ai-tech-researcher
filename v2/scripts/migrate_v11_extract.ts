/**
 * v11 (v3 Phase3): 本文抽出の試行記録。
 *   extract_attempted_at … 最後に抽出を試みた時刻
 *   extract_attempts     … 試行回数（0=未試行。キュー順で「未試行を優先」するのに使う）
 *   extract_error        … 最後の失敗理由タグ（http_404/timeout/too_short_N/not_html:...。成功時はNULL）
 *
 * これが無いと「キュー枯渇で未試行」と「試行して失敗」を区別できず、抽出率を上げても効果を測れない。
 *
 * 冪等（列があればSKIP）。実行: v2/ で `npx tsx scripts/migrate_v11_extract.ts`
 *   ローカルdev  : npx tsx scripts/migrate_v11_extract.ts
 *   本番         : USE_PROD=1 ... （※本番は書込トークンが要る。読み取り専用では失敗する）
 * push前に本番Tursoへ適用すること（未適用だと本番だけSQLエラー＝CLAUDE.md 第四条）。
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

const statements = [
  `ALTER TABLE collected_data ADD COLUMN extract_attempted_at TEXT`,
  `ALTER TABLE collected_data ADD COLUMN extract_attempts INTEGER DEFAULT 0`,
  `ALTER TABLE collected_data ADD COLUMN extract_error TEXT`,
  // 抽出キュー用: 「未試行を優先し、重要度降順」を索引で引く（全走査を避ける）
  `CREATE INDEX IF NOT EXISTS collected_extract_queue_idx
     ON collected_data (extract_attempts, importance_score DESC)`,
];

async function main() {
  console.log(`対象DB: ${process.env.TURSO_DATABASE_URL}`);
  for (const stmt of statements) {
    try {
      await client.execute(stmt);
      console.log('OK  :', stmt.split('\n')[0].slice(0, 70).trim());
    } catch (e: any) {
      console.log('SKIP:', e.message.slice(0, 90)); // duplicate column name 等
    }
  }

  // 既存データの初期化: 本文がある=過去に試行して成功したとみなし、試行済み(1回)として記録する。
  // 本文が無い記事は attempts=0（未試行扱い）＝「まだ測っていない」を正しく表す。
  const r = await client.execute(
    `UPDATE collected_data SET extract_attempts = 1 WHERE raw_content IS NOT NULL AND COALESCE(extract_attempts,0) = 0`
  ).catch((e: any) => { console.log('初期化SKIP:', e.message.slice(0, 80)); return null; });
  if (r) console.log(`\n初期化: 本文あり ${r.rowsAffected}件を attempts=1 に`);

  const c = await client.execute(
    `SELECT COALESCE(extract_attempts,0) a, count(*) c, sum(raw_content IS NOT NULL) has
     FROM collected_data GROUP BY 1 ORDER BY 1`
  ).catch(() => null);
  if (c) { console.log('\n試行回数の分布:'); console.table(c.rows); }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
