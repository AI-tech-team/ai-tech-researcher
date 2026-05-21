// v3.1: collected_data に title_ja（英語タイトルの日本語訳）を追加（冪等）
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  const info = await client.execute(`PRAGMA table_info(collected_data)`);
  if (!info.rows.some(r => r.name === 'title_ja')) {
    await client.execute(`ALTER TABLE collected_data ADD COLUMN title_ja TEXT`);
    console.log('追加: title_ja');
  } else {
    console.log('スキップ: title_ja（既存）');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
