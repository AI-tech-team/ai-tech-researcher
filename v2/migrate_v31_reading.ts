// v3.1 読書DNA: reading_events テーブル（冪等）
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS reading_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER REFERENCES collected_data(id),
      action TEXT NOT NULL,
      weight REAL DEFAULT 1,
      category TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS reading_events_created_idx ON reading_events(created_at)`);
  console.log('作成: reading_events');

  // 既存のお気に入り/既読/後で読むフラグから行動ログをバックフィル（テーブルが空のときのみ）
  const cnt = await client.execute(`SELECT COUNT(*) AS c FROM reading_events`);
  if (Number(cnt.rows[0]?.c ?? 0) === 0) {
    await client.execute(`INSERT INTO reading_events (article_id, action, weight, category, created_at)
      SELECT id, 'favorite', 3, category, created_at FROM collected_data WHERE is_favorited = 1`);
    await client.execute(`INSERT INTO reading_events (article_id, action, weight, category, created_at)
      SELECT id, 'read', 2, category, created_at FROM collected_data WHERE is_read = 1`);
    await client.execute(`INSERT INTO reading_events (article_id, action, weight, category, created_at)
      SELECT id, 'readlater', 1, category, created_at FROM collected_data WHERE is_read_later = 1`);
    const after = await client.execute(`SELECT COUNT(*) AS c FROM reading_events`);
    console.log(`バックフィル: ${after.rows[0]?.c}件の行動ログを生成`);
  } else {
    console.log('バックフィルスキップ（既存データあり）');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
