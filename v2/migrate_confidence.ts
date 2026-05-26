// 確信度スペクトルマイグレーション（冪等）: claims.confidence_score 追加
// 既存の confidence テキスト列(high/medium/low)から数値スコアに初期化する
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

config({ path: '.env.local' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await client.execute(`PRAGMA table_info(${table})`);
  return res.rows.some(r => r.name === column);
}

async function main() {
  console.log('=== 確信度スペクトルマイグレーション開始 ===');

  if (!(await columnExists('claims', 'confidence_score'))) {
    await client.execute(`ALTER TABLE claims ADD COLUMN confidence_score REAL DEFAULT 0.7`);
    console.log('claims.confidence_score カラム追加');

    // 既存データを text confidence から数値スコアに変換
    await client.execute(`
      UPDATE claims SET confidence_score = CASE confidence
        WHEN 'high'   THEN 0.85
        WHEN 'medium' THEN 0.70
        WHEN 'low'    THEN 0.50
        ELSE 0.70
      END
    `);
    const res = await client.execute(`SELECT COUNT(*) as cnt FROM claims`);
    console.log(`既存クレーム ${res.rows[0].cnt} 件を初期化`);
  } else {
    console.log('confidence_score 既存 → スキップ');
  }

  // reports テーブルが corpus_health タイプを受け入れられるか確認（制約なし → そのまま使える）
  console.log('=== マイグレーション完了 ===');
}

main().catch(console.error).finally(() => process.exit(0));
