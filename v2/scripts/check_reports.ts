/** 直近レポートの生成状況を確認する読み取り専用ユーティリティ。
 *  実行: v2/ で `npx tsx scripts/check_reports.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  const rows = (await client.execute(
    `SELECT id, type, report_date, datetime(created_at, '+9 hours') AS jst
     FROM reports ORDER BY created_at DESC LIMIT 12`
  )).rows as any[];
  console.log(`直近レポート ${rows.length}件（生成日時=JST）:`);
  for (const r of rows) {
    console.log(`  [${r.id}] ${String(r.type).padEnd(13)} report_date=${r.report_date}  生成(JST)=${r.jst}`);
  }
  // typeごとの最新
  const types = ['daily', 'weekly', 'monthly', 'briefing', 'cross_insight', 'learning_recap'];
  console.log('\ntype別の最新生成(JST):');
  for (const t of types) {
    const x = (await client.execute({
      sql: `SELECT datetime(created_at,'+9 hours') AS jst FROM reports WHERE type=? ORDER BY created_at DESC LIMIT 1`,
      args: [t],
    })).rows[0] as any;
    console.log(`  ${t.padEnd(14)}: ${x?.jst ?? '(無し)'}`);
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
