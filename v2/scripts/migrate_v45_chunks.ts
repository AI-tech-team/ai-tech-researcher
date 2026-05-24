/**
 * v4.5-A: パッセージレベルRAG用のチャンクテーブル＋ベクトルインデックス。
 * rawContentを~500トークンに分割した各チャンクの埋め込みを保持し、本文の該当段落を検索可能に。
 * 実行: v2/ で `npx tsx scripts/migrate_v45_chunks.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const EMBED_DIM = 768;
const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS content_chunks (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       article_id INTEGER NOT NULL REFERENCES collected_data(id),
       chunk_index INTEGER NOT NULL DEFAULT 0,
       text TEXT NOT NULL,
       embedding F32_BLOB(${EMBED_DIM}),
       created_at TEXT DEFAULT CURRENT_TIMESTAMP
     )`,
    `CREATE INDEX IF NOT EXISTS chunk_article_idx ON content_chunks(article_id)`,
    // ベクトルインデックス（コサイン距離）。NULL行は無視される。
    `CREATE INDEX IF NOT EXISTS chunk_embedding_idx ON content_chunks(libsql_vector_idx(embedding, 'metric=cosine'))`,
  ];
  for (const s of stmts) {
    try { await client.execute(s); console.log('OK:', s.split('\n')[0].slice(0, 64).trim()); }
    catch (e: any) { console.log('SKIP/ERR:', e.message.slice(0, 100)); }
  }
  const c = (await client.execute(`SELECT COUNT(*) AS c FROM content_chunks`)).rows[0] as any;
  console.log(`\ncontent_chunks 行数: ${c.c}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
