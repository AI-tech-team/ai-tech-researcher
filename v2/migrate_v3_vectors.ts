// v3ベクトル基盤マイグレーション（冪等）: collected_dataに埋め込み列・ストーリー列・ベクトルインデックスを追加
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

config({ path: '.env.local' });

const EMBED_DIM = 768;

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await client.execute(`PRAGMA table_info(${table})`);
  return res.rows.some(r => r.name === column);
}

async function main() {
  console.log('=== v3ベクトル基盤マイグレーション開始 ===');

  if (!(await columnExists('collected_data', 'embedding'))) {
    await client.execute(`ALTER TABLE collected_data ADD COLUMN embedding F32_BLOB(${EMBED_DIM})`);
    console.log(`追加: embedding F32_BLOB(${EMBED_DIM})`);
  } else {
    console.log('スキップ: embedding（既存）');
  }

  if (!(await columnExists('collected_data', 'story_id'))) {
    await client.execute(`ALTER TABLE collected_data ADD COLUMN story_id INTEGER`);
    console.log('追加: story_id INTEGER');
  } else {
    console.log('スキップ: story_id（既存）');
  }

  if (!(await columnExists('collected_data', 'story_count'))) {
    await client.execute(`ALTER TABLE collected_data ADD COLUMN story_count INTEGER DEFAULT 1`);
    console.log('追加: story_count INTEGER DEFAULT 1');
  } else {
    console.log('スキップ: story_count（既存）');
  }

  // ベクトルインデックス（コサイン距離）。NULL行は無視される。
  await client.execute(
    `CREATE INDEX IF NOT EXISTS collected_embedding_idx ON collected_data(libsql_vector_idx(embedding, 'metric=cosine'))`
  );
  console.log('作成: collected_embedding_idx（既存ならスキップ）');

  console.log('=== マイグレーション完了 ===');
  process.exit(0);
}

main().catch(e => { console.error('マイグレーション失敗:', e); process.exit(1); });
