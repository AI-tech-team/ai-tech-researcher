/**
 * `reading_events` テーブルを削除する。
 *
 * なぜ消すか: 「誰がどの記事をいつ開いたか」の個人の行動ログだが、
 *   - 書き込みは 2026-09-12 に停止済み（読書DNA／「あなた向け」推薦を撤去したため）
 *   - コードベース全体を検索しても **読み出す箇所が1つも無い**（残るのは退会時の delete のみ）
 *   - 本番に 68行 / 4人分 / 2026-05-17〜2026-07-31 が残っていた
 * つまり「価値ゼロ・責任だけ」の個人データ。持たないことが唯一確実な保護なので、行ごと消す。
 * （プライバシーポリシーの「必要最小限」と、VibeCoding 第三条のPII最小化に合わせる）
 *
 * ⚠ 復元しない前提の削除。scripts/backup.ts はもともとユーザー系テーブルを
 *   ダンプ対象から外しているので、この68行のバックアップはどこにも無い。それでよい。
 *
 * 使い方:
 *   npx tsx scripts/migrate_2026_09_13_drop_reading_events.ts .env.prod.readonly --dry  # 確認だけ
 *   npx tsx scripts/migrate_2026_09_13_drop_reading_events.ts .env.prod.write           # 適用
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

const envPath = process.argv[2];
const dry = process.argv.includes('--dry');
if (!envPath) {
  console.error('使い方: npx tsx scripts/migrate_2026_09_13_drop_reading_events.ts <envファイル> [--dry]');
  process.exit(1);
}
config({ path: envPath });

const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql: string) => (await c.execute(sql)).rows;

async function main() {
  // 接続先を必ず出す（dev と prod は1文字違い＝ -dev- / -db- で、取り違えると気づけない）
  const host = String(process.env.TURSO_DATABASE_URL).replace(/^libsql:\/\//, '').split('.')[0];
  console.log(`接続先: ${host}  ${dry ? '(dry run)' : '(書き込み)'}`);

  const exists = (await q(`SELECT name FROM sqlite_master WHERE type='table' AND name='reading_events'`)).length > 0;
  if (!exists) {
    console.log('reading_events: 存在しない（適用済み）');
    return;
  }

  const [row] = await q(`SELECT COUNT(*) n, COUNT(DISTINCT user_id) users, MIN(created_at) first, MAX(created_at) last FROM reading_events`);
  console.log(`reading_events: ${row.n}行 / ${row.users}人 / ${row.first} 〜 ${row.last}`);

  if (dry) {
    console.log('  → DROP TABLE reading_events;  (dry run のため実行しない)');
    return;
  }
  await c.execute(`DROP TABLE reading_events`);
  console.log('  → 削除した');

  const after = (await q(`SELECT name FROM sqlite_master WHERE type='table' AND name='reading_events'`)).length;
  console.log(`確認: reading_events は ${after === 0 ? '存在しない' : '**まだ存在する（失敗）**'}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
