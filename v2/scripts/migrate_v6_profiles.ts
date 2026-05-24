/** v6 認証③: user_profiles テーブル。実行: v2/ で `npx tsx scripts/migrate_v6_profiles.ts` */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });
const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
async function main() {
  try {
    await client.execute(`CREATE TABLE IF NOT EXISTS user_profiles (
       user_id INTEGER PRIMARY KEY,
       display_name TEXT,
       interests TEXT,
       goals TEXT,
       email_opt_in INTEGER DEFAULT 0,
       updated_at TEXT DEFAULT CURRENT_TIMESTAMP
     )`);
    console.log('OK: user_profiles 作成');
  } catch (e: any) { console.log('SKIP/ERR:', e.message.slice(0, 100)); }
  const c = (await client.execute(`SELECT COUNT(*) AS c FROM user_profiles`)).rows[0] as any;
  console.log(`user_profiles 行数: ${c.c}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
