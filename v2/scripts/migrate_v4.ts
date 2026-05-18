import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  const migrations = [
    'ALTER TABLE collected_data ADD COLUMN is_read INTEGER DEFAULT 0',
    'ALTER TABLE collected_data ADD COLUMN tags TEXT',
    `CREATE TABLE IF NOT EXISTS pipeline_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      collected INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
  ];

  for (const stmt of migrations) {
    try {
      await client.execute(stmt);
      console.log('OK:', stmt.split('\n')[0].slice(0, 80));
    } catch (e: any) {
      console.log('SKIP:', e.message.slice(0, 80));
    }
  }

  console.log('Migration v4 complete.');
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
