// v3知識グラフ用マイグレーション（冪等）: entities/benchmarks/relations + claims拡張
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

config({ path: '.env.local' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await client.execute(`PRAGMA table_info(${table})`);
  return res.rows.some(r => r.name === column);
}

async function main() {
  console.log('=== v3知識グラフマイグレーション開始 ===');

  // claims拡張
  for (const [col, ddl] of [
    ['entity_id', 'ALTER TABLE claims ADD COLUMN entity_id INTEGER'],
    ['valid_from', 'ALTER TABLE claims ADD COLUMN valid_from TEXT'],
    ['status', `ALTER TABLE claims ADD COLUMN status TEXT DEFAULT 'active'`],
  ] as const) {
    if (!(await columnExists('claims', col))) {
      await client.execute(ddl);
      console.log(`claims追加: ${col}`);
    } else {
      console.log(`claimsスキップ: ${col}（既存）`);
    }
  }

  // entities
  await client.execute(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL,
      normalized_key TEXT NOT NULL UNIQUE,
      type TEXT DEFAULT 'model',
      aliases TEXT,
      mention_count INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  console.log('作成: entities');

  // benchmarks
  await client.execute(`
    CREATE TABLE IF NOT EXISTS benchmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER REFERENCES entities(id),
      entity_name TEXT NOT NULL,
      benchmark_name TEXT NOT NULL,
      score REAL NOT NULL,
      unit TEXT,
      article_id INTEGER REFERENCES collected_data(id),
      source_url TEXT,
      recorded_date TEXT,
      confidence TEXT DEFAULT 'medium',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS benchmarks_name_idx ON benchmarks(benchmark_name)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS benchmarks_entity_idx ON benchmarks(entity_id)`);
  console.log('作成: benchmarks');

  // relations
  await client.execute(`
    CREATE TABLE IF NOT EXISTS relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_entity_id INTEGER REFERENCES entities(id),
      subject_name TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      object_entity_id INTEGER REFERENCES entities(id),
      object_name TEXT NOT NULL,
      article_id INTEGER REFERENCES collected_data(id),
      confidence TEXT DEFAULT 'medium',
      valid_from TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  await client.execute(`CREATE INDEX IF NOT EXISTS relations_subject_idx ON relations(subject_entity_id)`);
  // 同一エッジの重複防止（記事をまたいでも同一(subject,relation,object)は1行に集約）
  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS relations_edge_uniq ON relations(subject_name, relation_type, object_name)`);
  console.log('作成: relations');

  console.log('=== マイグレーション完了 ===');
  process.exit(0);
}

main().catch(e => { console.error('マイグレーション失敗:', e); process.exit(1); });
