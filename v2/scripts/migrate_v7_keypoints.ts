/**
 * v7: 記事ページの「要点」用カラムを追加する。
 * - collected_data.key_points  (TEXT / JSON配列 '["要点1",...]')
 * - collected_data.why_matters (TEXT / 1行)
 * 抽出本文(raw_content)は著作権上そのまま公開できない(第三条)ため、
 * LLMが書き起こした要点を別カラムで持たせて記事ページに出す。
 *
 * 再実行安全（既に列があればスキップ）。
 * 実行: v2/ で `npx tsx scripts/migrate_v7_keypoints.ts`
 * ※ push前に本番Tursoへ適用すること（未適用のままpushすると本番だけ落ちる = [[reference-dev-env]]）
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  console.log(`DB: ${process.env.TURSO_DATABASE_URL}`);

  const cols = (await client.execute(`PRAGMA table_info(collected_data)`)).rows as any[];
  const has = (name: string) => cols.some((c: any) => c.name === name);

  for (const [name, ddl] of [
    ['key_points', `ALTER TABLE collected_data ADD COLUMN key_points TEXT`],
    ['why_matters', `ALTER TABLE collected_data ADD COLUMN why_matters TEXT`],
  ] as const) {
    if (has(name)) { console.log(`SKIP: ${name} は既に存在`); continue; }
    await client.execute(ddl);
    console.log(`OK: ${name} を追加`);
  }

  const after = (await client.execute(`PRAGMA table_info(collected_data)`)).rows as any[];
  console.log('列:', after.map((c: any) => c.name).join(', '));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
