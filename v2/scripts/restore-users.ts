// backup-users.ts が書いた暗号化バックアップから会員データを復元する。
//
// 監査で「復旧スクリプトが1本も無く、復旧手順そのものが未検証」と指摘された点への対応。
// **まず必ず --dry-run で件数を確認すること。**
//
//   npx tsx scripts/restore-users.ts private-backups/users_2026-09-10.json.enc --dry-run
//   BACKUP_PASSPHRASE='...' npx tsx scripts/restore-users.ts <file> --confirm
//
// 復元は「同じ主キーがあれば上書き、無ければ挿入」。既存の行を消すことはしない。
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { scryptSync, createDecipheriv } from 'node:crypto';
import * as schema from '../src/db/schema';

config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const [, , file, ...flags] = process.argv;
const dryRun = flags.includes('--dry-run');
const confirmed = flags.includes('--confirm');
if (!file) { console.error('使い方: restore-users.ts <file.json.enc> [--dry-run|--confirm]'); process.exit(1); }
if (!dryRun && !confirmed) { console.error('本番へ書き込むには --confirm が必要です（先に --dry-run を推奨）'); process.exit(1); }

const pass = process.env.BACKUP_PASSPHRASE;
if (!pass) { console.error('BACKUP_PASSPHRASE を設定してください'); process.exit(1); }

// テーブルは外部キーの向きに沿った順で復元する（users が先、それを参照する行が後）
const ORDER: Array<[string, any]> = [
  ['users', schema.users],
  ['userProfiles', schema.userProfiles],
  ['userArticleState', schema.userArticleState],
  ['readingEvents', schema.readingEvents],
  ['userTopicWeights', schema.userTopicWeights],
  ['chatMemory', schema.chatMemory],
  ['pushSubscriptions', schema.pushSubscriptions],
];

async function main() {
  const raw = readFileSync(file);
  const salt = raw.subarray(0, 16), iv = raw.subarray(16, 28), tag = raw.subarray(28, 44), enc = raw.subarray(44);
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(pass!, salt, 32), iv);
  decipher.setAuthTag(tag);
  let json: string;
  try {
    json = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf-8');
  } catch {
    console.error('復号に失敗しました。パスフレーズが違うか、ファイルが壊れています。');
    process.exit(1);
  }
  const data = JSON.parse(json) as Record<string, unknown>;
  console.log(`[Restore] ${data.date} 時点のバックアップ（kind=${data.kind}）`);

  for (const [name] of ORDER) {
    const rows = (data[name] as unknown[]) ?? [];
    console.log(`  ${name}: ${rows.length}件`);
  }
  if (dryRun) { console.log('\n--dry-run のため書き込みませんでした。'); process.exit(0); }

  const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  const db = drizzle(client, { schema });
  const t0 = Date.now();
  for (const [name, table] of ORDER) {
    const rows = (data[name] as Record<string, unknown>[]) ?? [];
    let done = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      if (!chunk.length) continue;
      // 冪等（第四条）: 途中で落ちても同じコマンドで再開できる
      await db.insert(table).values(chunk as never).onConflictDoNothing();
      done += chunk.length;
    }
    console.log(`  ${name}: ${done}件を復元`);
  }
  console.log(`[Restore] 完了（${((Date.now() - t0) / 1000).toFixed(1)}秒）`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
