/** 遡及収穫(score=3)で登録したrssフィードを削除（ゲート緩すぎたためロールバック）。*/
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });
const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
async function main() {
  const before = (await client.execute(`SELECT COUNT(*) AS c FROM sources WHERE type='rss' AND score=3`)).rows[0] as any;
  console.log(`削除対象(rss score=3): ${before.c}件`);
  const r = await client.execute(`DELETE FROM sources WHERE type='rss' AND score=3`);
  console.log(`削除完了: ${r.rowsAffected}件`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
