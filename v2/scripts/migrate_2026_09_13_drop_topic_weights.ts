/**
 * `user_topic_weights` テーブルを削除する。
 *
 * reading_events と同じ理由。「このユーザーはこの語に興味がある」という個人の学習結果だが、
 *   - 書き込みは 2026-09-12 に停止済み（「あなた向け」推薦を撤去したため）
 *   - コードベース全体で**読み出す箇所が1つも無い**（残るのは退会時の delete のみ）
 *   - 本番に 31行 / 3人分 / 最終更新 2026-07-31 が残っていた
 * 価値ゼロのまま責任だけが残る個人データなので、行ごと消す。
 *
 * ⚠ 復元しない前提の削除。scripts/backup.ts はユーザー系テーブルをダンプ対象から外しているので
 *   この31行のバックアップはどこにも無い。それでよい。
 *
 * 使い方:
 *   npx tsx scripts/migrate_2026_09_13_drop_topic_weights.ts .env.prod.readonly --dry
 *   npx tsx scripts/migrate_2026_09_13_drop_topic_weights.ts .env.prod.write
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

const envPath = process.argv[2];
const dry = process.argv.includes('--dry');
if (!envPath) {
  console.error('使い方: npx tsx scripts/migrate_2026_09_13_drop_topic_weights.ts <envファイル> [--dry]');
  process.exit(1);
}
config({ path: envPath });

const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql: string) => (await c.execute(sql)).rows;

async function main() {
  // 接続先を必ず出す（dev と prod は1文字違い＝ -dev- / -db- で、取り違えると気づけない）
  const host = String(process.env.TURSO_DATABASE_URL).replace(/^libsql:\/\//, '').split('.')[0];
  console.log(`接続先: ${host}  ${dry ? '(dry run)' : '(書き込み)'}`);

  const exists = (await q(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_topic_weights'`)).length > 0;
  if (!exists) { console.log('user_topic_weights: 存在しない（適用済み）'); return; }

  const [row] = await q(`SELECT COUNT(*) n, COUNT(DISTINCT user_id) users, MAX(updated_at) last FROM user_topic_weights`);
  console.log(`user_topic_weights: ${row.n}行 / ${row.users}人 / 最終更新 ${row.last}`);

  if (dry) { console.log('  → DROP TABLE user_topic_weights;  (dry run のため実行しない)'); return; }
  await c.execute(`DROP TABLE user_topic_weights`);
  console.log('  → 削除した');
  const after = (await q(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_topic_weights'`)).length;
  console.log(`確認: user_topic_weights は ${after === 0 ? '存在しない' : '**まだ存在する（失敗）**'}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
