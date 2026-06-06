/**
 * v6 認証③: user_topic_weights をユーザー別に分離。
 * - keyword 単独 unique → (user_id, keyword) unique
 * - 既存行はオーナー(OWNER_EMAIL)へ移行
 * 実行: v2/ で `npx tsx scripts/migrate_v6_topic_weights.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const run = async (sql: string, args?: unknown[]) => {
  try {
    await client.execute({ sql, args: args as any[] });
    console.log('OK:', sql.split('\n')[0].slice(0, 72).trim());
  } catch (e: any) {
    console.log('SKIP/ERR:', e.message.slice(0, 90));
  }
};

async function main() {
  const ownerEmail = (process.env.OWNER_EMAIL ?? '').split(',')[0].trim().toLowerCase();
  if (!ownerEmail) { console.log('OWNER_EMAIL 未設定のため移行を中止しました。'); process.exit(1); }
  const owner = (await client.execute({
    sql: `SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`, args: [ownerEmail],
  })).rows[0] as any;
  if (!owner) { console.log(`OWNER_EMAIL(${ownerEmail}) のユーザーが未登録のため移行スキップ`); process.exit(0); }
  const ownerId = Number(owner.id);
  console.log(`オーナー user_id = ${ownerId}`);

  // 既に user_id 列がある場合はスキップ（再実行安全）
  const cols = (await client.execute(`PRAGMA table_info(user_topic_weights)`)).rows as any[];
  const hasUserId = cols.some((c: any) => c.name === 'user_id');
  if (hasUserId) {
    const nullCnt = (await client.execute(`SELECT COUNT(*) AS c FROM user_topic_weights WHERE user_id IS NULL`)).rows[0] as any;
    if (Number(nullCnt.c) > 0) {
      const r = await client.execute({ sql: `UPDATE user_topic_weights SET user_id = ? WHERE user_id IS NULL`, args: [ownerId] });
      console.log(`user_id NULL をオーナーへ: ${r.rowsAffected}件`);
    }
    console.log('user_id 列あり — テーブル再構築はスキップ');
    process.exit(0);
  }

  await run(`CREATE TABLE user_topic_weights_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    keyword TEXT NOT NULL,
    weight REAL DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS utw_user_keyword ON user_topic_weights_new(user_id, keyword)`);

  const mig = await client.execute({
    sql: `INSERT OR IGNORE INTO user_topic_weights_new (user_id, keyword, weight, updated_at)
          SELECT ?, keyword, weight, updated_at FROM user_topic_weights`,
    args: [ownerId],
  });
  console.log(`既存重みを移行: ${mig.rowsAffected}件`);

  await run(`DROP TABLE user_topic_weights`);
  await run(`ALTER TABLE user_topic_weights_new RENAME TO user_topic_weights`);

  const cnt = (await client.execute(`SELECT COUNT(*) AS c FROM user_topic_weights`)).rows[0] as any;
  console.log(`user_topic_weights 行数: ${cnt.c}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
