// レート制限テーブルmigration（冪等）。固定ウィンドウ・カウンタ用。
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

config({ path: '.env.local' });
config();

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('=== rate_limits マイグレーション開始 ===');
  await client.execute(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL
    )
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON rate_limits(expires_at)`);
  console.log('rate_limits 準備完了');
  console.log('=== マイグレーション完了 ===');
}

main().catch(console.error).finally(() => process.exit(0));
