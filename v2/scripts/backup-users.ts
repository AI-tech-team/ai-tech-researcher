// 会員データの暗号化バックアップ。**手元で実行する。CIでは走らせない。**
//
// なぜ別スクリプトなのか（2026-09-10 監査）:
//   scripts/backup.ts は users 系6テーブルを意図的に除外している。公開リポジトリにコミットされるので
//   その判断は正しい。しかし**代わりの退避先が存在しなかった**ため、Turso のアカウント停止・DB削除・
//   トークン事故で、全会員のアカウント／メール購読／お気に入り／読書履歴が復旧不能だった。
//   記事は再収集できるが、会員は再取得できない＝事業化したとき唯一の代替不能資産がここにある。
//
// 保管の約束:
//   - 出力先 v2/private-backups/ は .gitignore と .vercelignore の両方に入れてある
//   - 中身は AES-256-GCM で暗号化する。鍵は BACKUP_PASSPHRASE（env）から scrypt で導出する
//   - パスフレーズは OneDrive 同期フォルダに置かない。パスワードマネージャに保管すること
//
// 使い方:
//   BACKUP_PASSPHRASE='...' npx tsx scripts/backup-users.ts
//   復元は scripts/restore-users.ts（まず --dry-run で件数を確認する）
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes, scryptSync, createCipheriv } from 'node:crypto';
import * as schema from '../src/db/schema';

config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const pass = process.env.BACKUP_PASSPHRASE;
if (!pass || pass.length < 12) {
  console.error('BACKUP_PASSPHRASE（12文字以上）を設定してください。暗号化せずに会員データを書き出すことはしません。');
  process.exit(1);
}

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const db = drizzle(client, { schema });

/** 会員に紐づく＝再取得できないテーブル。ここが唯一の代替不能資産。 */
const TABLES: Record<string, any> = {
  users: schema.users,
  userProfiles: schema.userProfiles,
  userArticleState: schema.userArticleState,
  userTopicWeights: schema.userTopicWeights,
  chatMemory: schema.chatMemory,
  pushSubscriptions: schema.pushSubscriptions,
};

/** chat_memory.embedding は F32_BLOB で JSON に載らないうえ再生成可能なので落とす。 */
const DROP_COLUMNS: Record<string, string[]> = { chatMemory: ['embedding'] };

async function main() {
  const date = new Date().toISOString().split('T')[0];
  const dir = join(process.cwd(), 'private-backups');
  mkdirSync(dir, { recursive: true });

  const out: Record<string, unknown> = { date, kind: 'users', schemaVersion: 1 };
  for (const [name, table] of Object.entries(TABLES)) {
    const rows = await db.select().from(table);
    const drop = DROP_COLUMNS[name];
    out[name] = drop
      ? rows.map((r) => { const o = { ...(r as Record<string, unknown>) }; for (const c of drop) delete o[c]; return o; })
      : rows;
    console.log(`  ${name}: ${rows.length}件`);
  }

  const plain = Buffer.from(JSON.stringify(out), 'utf-8');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(pass!, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  // salt(16) | iv(12) | tag(16) | 暗号文 を1ファイルに連結する
  const filePath = join(dir, `users_${date}.json.enc`);
  writeFileSync(filePath, Buffer.concat([salt, iv, tag, enc]));
  console.log(`[BackupUsers] 完了: ${filePath}（${(enc.length / 1024).toFixed(1)} KiB・暗号化済み）`);
  console.log('  この1ファイルを、このPCとOneDriveの外にも1部置いてください。');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
