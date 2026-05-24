/**
 * v6: マルチユーザー基盤。usersテーブルを作成。
 * 実行: v2/ で `npx tsx scripts/migrate_v6_users.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       email TEXT NOT NULL UNIQUE,
       name TEXT,
       image TEXT,
       created_at TEXT DEFAULT CURRENT_TIMESTAMP
     )`,
  ];
  for (const s of stmts) {
    try { await client.execute(s); console.log('OK:', s.split('\n')[0].slice(0, 60).trim()); }
    catch (e: any) { console.log('SKIP/ERR:', e.message.slice(0, 100)); }
  }
  const c = (await client.execute(`SELECT COUNT(*) AS c FROM users`)).rows[0] as any;
  console.log(`users 行数: ${c.c}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
