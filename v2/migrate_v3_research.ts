// v3自律リサーチ用マイグレーション（冪等）: research_questions / alerts
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

config({ path: '.env.local' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('=== v3自律リサーチマイグレーション開始 ===');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS research_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      origin TEXT NOT NULL,
      origin_ref TEXT,
      article_id INTEGER REFERENCES collected_data(id),
      status TEXT DEFAULT 'pending',
      findings TEXT,
      findings_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      investigated_at TEXT
    )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS research_status_idx ON research_questions(status)`);
  console.log('作成: research_questions');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      reason TEXT NOT NULL,
      entity_name TEXT,
      severity TEXT DEFAULT 'watch',
      related_article_id INTEGER REFERENCES collected_data(id),
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS alerts_status_idx ON alerts(status)`);
  console.log('作成: alerts');

  console.log('=== マイグレーション完了 ===');
  process.exit(0);
}

main().catch(e => { console.error('マイグレーション失敗:', e); process.exit(1); });
