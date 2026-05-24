/**
 * v6 認証②: ユーザー別状態テーブル。
 * - user_article_state(userId, articleId, fav/readlater/read) ＋ unique(userId,articleId)
 * - reading_events に user_id 追加
 * - 既存のグローバル状態(collected_data の fav/readlater/read)と reading_events を
 *   オーナー(最初のユーザー)へ移行して保持する。
 * 実行: v2/ で `npx tsx scripts/migrate_v6_userstate.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const run = async (sql: string) => { try { await client.execute(sql); console.log('OK:', sql.split('\n')[0].slice(0, 64).trim()); } catch (e: any) { console.log('SKIP/ERR:', e.message.slice(0, 90)); } };

async function main() {
  await run(`CREATE TABLE IF NOT EXISTS user_article_state (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL,
     article_id INTEGER NOT NULL,
     is_favorited INTEGER DEFAULT 0,
     is_read_later INTEGER DEFAULT 0,
     is_read INTEGER DEFAULT 0,
     updated_at TEXT DEFAULT CURRENT_TIMESTAMP
   )`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS uas_user_article ON user_article_state(user_id, article_id)`);
  await run(`ALTER TABLE reading_events ADD COLUMN user_id INTEGER`);

  // オーナー = 最初のユーザー
  const owner = (await client.execute(`SELECT id FROM users ORDER BY id ASC LIMIT 1`)).rows[0] as any;
  if (!owner) { console.log('ユーザー未登録のため移行スキップ（ログイン後に再実行可）'); process.exit(0); }
  const ownerId = Number(owner.id);
  console.log(`オーナー user_id = ${ownerId}`);

  // 既存グローバル状態をオーナーへ移行
  const mig = await client.execute({
    sql: `INSERT OR IGNORE INTO user_article_state (user_id, article_id, is_favorited, is_read_later, is_read)
          SELECT ?, id, COALESCE(is_favorited,0), COALESCE(is_read_later,0), COALESCE(is_read,0)
          FROM collected_data
          WHERE COALESCE(is_favorited,0)=1 OR COALESCE(is_read_later,0)=1 OR COALESCE(is_read,0)=1`,
    args: [ownerId],
  });
  console.log(`記事状態を移行: ${mig.rowsAffected}件`);

  // 既存 reading_events をオーナーへ
  const re = await client.execute({ sql: `UPDATE reading_events SET user_id = ? WHERE user_id IS NULL`, args: [ownerId] });
  console.log(`reading_events 移行: ${re.rowsAffected}件`);

  const cnt = (await client.execute(`SELECT COUNT(*) AS c FROM user_article_state`)).rows[0] as any;
  console.log(`user_article_state 行数: ${cnt.c}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
