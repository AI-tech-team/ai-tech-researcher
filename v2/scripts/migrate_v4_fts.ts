/**
 * v4 フェーズ3: ハイブリッドRAG用のFTS5全文検索インデックスを構築。
 * trigramトークナイザでCJK(日本語)も部分一致可能にする。
 * collected_data の external-content FTS5＋同期トリガで自動メンテ。
 * 実行: v2/ で `npx tsx scripts/migrate_v4_fts.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

const statements = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS collected_fts USING fts5(
     title, summary, raw_content,
     content='collected_data', content_rowid='id', tokenize='trigram'
   )`,
  // 既存データから索引を再構築
  `INSERT INTO collected_fts(collected_fts) VALUES('rebuild')`,
  // 同期トリガ（INSERT/DELETE/UPDATE）
  `CREATE TRIGGER IF NOT EXISTS collected_fts_ai AFTER INSERT ON collected_data BEGIN
     INSERT INTO collected_fts(rowid, title, summary, raw_content)
       VALUES (new.id, new.title, new.summary, new.raw_content);
   END`,
  `CREATE TRIGGER IF NOT EXISTS collected_fts_ad AFTER DELETE ON collected_data BEGIN
     INSERT INTO collected_fts(collected_fts, rowid, title, summary, raw_content)
       VALUES ('delete', old.id, old.title, old.summary, old.raw_content);
   END`,
  `CREATE TRIGGER IF NOT EXISTS collected_fts_au AFTER UPDATE ON collected_data BEGIN
     INSERT INTO collected_fts(collected_fts, rowid, title, summary, raw_content)
       VALUES ('delete', old.id, old.title, old.summary, old.raw_content);
     INSERT INTO collected_fts(rowid, title, summary, raw_content)
       VALUES (new.id, new.title, new.summary, new.raw_content);
   END`,
];

async function main() {
  for (const stmt of statements) {
    try {
      await client.execute(stmt);
      console.log('OK:', stmt.split('\n')[0].slice(0, 70).trim());
    } catch (e: any) {
      console.log('SKIP/ERR:', e.message.slice(0, 100));
    }
  }
  // 動作確認
  const cnt = (await client.execute(`SELECT COUNT(*) AS c FROM collected_fts`)).rows[0] as any;
  const hit = await client.execute(`SELECT rowid FROM collected_fts WHERE collected_fts MATCH '"transformer"' LIMIT 3`);
  console.log(`\nFTS行数: ${cnt.c} / "transformer"ヒット: ${hit.rows.length}件`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
