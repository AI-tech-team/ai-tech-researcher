/**
 * C 長期記憶: チャット発話をユーザー別にベクトル保存する chat_memory テーブル＋ベクトルインデックス。
 * セッションを跨いで過去の会話を意味検索し、文脈として注入するための基盤。
 * 実行: v2/ で `npx tsx scripts/migrate_c_chatmemory.ts`（冪等）
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const EMBED_DIM = 768;
const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS chat_memory (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id INTEGER NOT NULL,
       role TEXT NOT NULL,
       content TEXT NOT NULL,
       embedding F32_BLOB(${EMBED_DIM}),
       created_at TEXT DEFAULT CURRENT_TIMESTAMP
     )`,
    `CREATE INDEX IF NOT EXISTS chat_memory_user_idx ON chat_memory(user_id)`,
    // ベクトルインデックス（コサイン距離）。NULL行は無視される。
    `CREATE INDEX IF NOT EXISTS chat_memory_embedding_idx ON chat_memory(libsql_vector_idx(embedding, 'metric=cosine'))`,
  ];
  for (const s of stmts) {
    try { await client.execute(s); console.log('OK:', s.split('\n')[0].slice(0, 64).trim()); }
    catch (e: any) { console.log('SKIP/ERR:', e.message.slice(0, 100)); }
  }
  const c = (await client.execute(`SELECT COUNT(*) AS c FROM chat_memory`)).rows[0] as any;
  console.log(`\nchat_memory 行数: ${c.c}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
