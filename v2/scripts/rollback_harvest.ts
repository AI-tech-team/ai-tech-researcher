/** 遡及収穫(score=3)で登録したrssフィードを削除（ゲート緩すぎたためロールバック）。
 *  ⚠️ 重要: score=3 は本番の自動フィード発見(daily_pipeline.ts evolveSources)も恒常的に使う値。
 *  そのため score=3 の rss を無差別に消すと、稼働中の正規フィードまで巻き込んで恒久削除する危険がある。
 *  事故防止のため: (1) 既定はドライラン（対象を一覧表示するだけ）、(2) CONFIRM=1 のときのみ実削除。
 *  実行前に必ず `npx tsx scripts/backup.ts` でバックアップを取ること。
 *  実行例: ドライラン → `npx tsx scripts/rollback_harvest.ts`
 *          実削除   → `CONFIRM=1 npx tsx scripts/rollback_harvest.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });
const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  const targets = (await client.execute(
    `SELECT id, value, created_at FROM sources WHERE type='rss' AND score=3 ORDER BY created_at`
  )).rows as any[];
  console.log(`削除対象(rss score=3): ${targets.length}件`);
  for (const t of targets) console.log(`  - [${t.id}] ${t.value}  (登録: ${t.created_at})`);

  if (targets.length === 0) { console.log('対象なし。終了。'); process.exit(0); }

  if (process.env.CONFIRM !== '1') {
    console.log('\n⚠️ score=3 は本番の自動発見フィードも使う値です。稼働中の正規フィードまで消える恐れがあります。');
    console.log('   上記一覧を確認し、backup.ts を取得した上で、実削除するなら CONFIRM=1 を付けて再実行してください。');
    console.log('   （現在はドライラン: 削除していません）');
    process.exit(0);
  }

  const r = await client.execute(`DELETE FROM sources WHERE type='rss' AND score=3`);
  console.log(`削除完了: ${r.rowsAffected}件`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
