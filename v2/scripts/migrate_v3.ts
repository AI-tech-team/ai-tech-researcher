import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  const migrations = [
    'ALTER TABLE collected_data ADD COLUMN is_read_later INTEGER DEFAULT 0',
    'ALTER TABLE collected_data ADD COLUMN importance_score INTEGER DEFAULT 5',
  ];

  for (const stmt of migrations) {
    try {
      await client.execute(stmt);
      console.log('OK:', stmt);
    } catch (e: any) {
      console.log('SKIP (already exists?):', e.message);
    }
  }

  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
