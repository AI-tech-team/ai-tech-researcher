/** 登録ユーザー(メールアドレス)数を集計する読み取り専用ユーティリティ。
 *  実行: v2/ で `npx tsx scripts/count_users.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  const one = async (sql: string) => Number(((await client.execute(sql)).rows[0] as any).n ?? 0);
  const total = await one('SELECT COUNT(*) AS n FROM users');
  const week = await one(`SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now','-7 days')`);
  const day = await one(`SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now','-1 day')`);
  const profiles = await one('SELECT COUNT(*) AS n FROM user_profiles');
  console.log(`登録ユーザー(アドレス)数: ${total}`);
  console.log(`  直近7日の新規: ${week} / 直近24h: ${day}`);
  console.log(`  プロフィール設定済: ${profiles}`);
  process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
