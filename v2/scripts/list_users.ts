/** 登録ユーザー(メールアドレス)一覧を表示する読み取り専用ユーティリティ（オーナー確認用）。
 *  実行: v2/ で `npx tsx scripts/list_users.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const owners = (process.env.OWNER_EMAIL ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

async function main() {
  // created_at はUTC格納。表示はJST(+9h)に変換する
  const rows = (await client.execute(
    `SELECT id, email, name, datetime(created_at, '+9 hours') AS jst FROM users ORDER BY created_at ASC, id ASC`
  )).rows as any[];
  console.log(`登録ユーザー ${rows.length}件（登録日時はJST）:`);
  for (const r of rows) {
    const isOwner = owners.includes(String(r.email ?? '').toLowerCase());
    console.log(`  [${r.id}] ${r.email}${r.name ? ` (${r.name})` : ''}  登録(JST): ${r.jst}${isOwner ? '  ← オーナー' : ''}`);
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
