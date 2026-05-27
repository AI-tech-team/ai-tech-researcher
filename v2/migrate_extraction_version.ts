// 知識抽出バージョンmigration（冪等）: collected_data.extraction_version 追加
// 抽出ロジックを変えたら EXTRACTION_VERSION を上げ、未満の記事をBatchで再抽出する。
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

config({ path: '.env.local' });
config();

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await client.execute(`PRAGMA table_info(${table})`);
  return res.rows.some(r => r.name === column);
}

async function main() {
  console.log('=== extraction_version マイグレーション開始 ===');
  if (!(await columnExists('collected_data', 'extraction_version'))) {
    await client.execute(`ALTER TABLE collected_data ADD COLUMN extraction_version INTEGER DEFAULT 0`);
    console.log('collected_data.extraction_version カラム追加（既存は全て 0）');
  } else {
    console.log('extraction_version 既存 → スキップ');
  }
  console.log('=== マイグレーション完了 ===');
}

main().catch(console.error).finally(() => process.exit(0));
