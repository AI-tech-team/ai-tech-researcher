/**
 * v10: Web Push通知の購読テーブル。
 *   push_subscriptions … ブラウザ発行のプッシュ購読(endpoint + 暗号化キー)。ログイン不要・PIIなし。
 *   日次ダイジェスト生成時にパイプラインが全購読へ送信する。
 *
 * 実行: v2/ で `npx tsx scripts/migrate_v10_push.ts`（push前に本番Tursoへ適用＝CLAUDE.md 第四条）
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

const statements = [
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     endpoint TEXT NOT NULL UNIQUE,
     p256dh TEXT NOT NULL,
     auth TEXT NOT NULL,
     user_id INTEGER,
     created_at TEXT DEFAULT CURRENT_TIMESTAMP
   )`,
];

async function main() {
  for (const stmt of statements) {
    try {
      await client.execute(stmt);
      console.log('OK  :', stmt.split('\n')[0].slice(0, 60).trim());
    } catch (e: any) {
      console.log('SKIP:', e.message.slice(0, 90));
    }
  }
  const c = await client.execute(`SELECT count(*) c FROM push_subscriptions`).catch(() => null);
  console.log(`\npush_subscriptions: ${c ? (c.rows[0] as any).c : '作成失敗'}行`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
