/**
 * collected_data.url に生のまま残っている HTML エンティティを実体に戻す（1回きりの遡及補正）。
 *
 * 経緯（2026-09-15 実測）: 本番23,649件のうち **2,083件（8.8%）** のURLに `&#45;`（ハイフン）
 * `&#038;`（&）が残っていた。`#` はフラグメント開始なので、ブラウザは `#` より前だけを取りに行く。
 * gigazineで実際に叩くと **404ではなくHTTP 200で無関係な記事**が返った:
 *   押した見出し … ジャック・ドーシーのBlockが「Buzz」をリリース
 *   着地した記事 … 「数千分の1秒で動作するカメラのシャッター」をスーパースローで撮影
 * リンク切れなら読者は気づくが、これは静かに間違った場所へ運ぶので気づけない。
 *
 * 取り込み側は2026-09-10のエンティティ監査で修正済み（以降の収集は壊れ0件を実測）。
 * 描画側も safeHttpUrl で解くようにした（2026-09-15）ので**読者への実害はこの時点で消える**。
 * このスクリプトはDBの値そのものを揃えるためのもので、急がない。
 * 揃えておく理由: 重複判定・検索・エクスポートなど、描画を通らない経路が生のURLを見るため。
 *
 * ⚠ 本番DBへの書き込み。既定はドライラン。実行は `--apply` を明示したときだけ。
 *   使い方: npx tsx scripts/fix_entity_urls.ts          （何件変わるかを見るだけ）
 *           npx tsx scripts/fix_entity_urls.ts --apply  （オーナーのGOを得てから）
 */
import { createClient } from '@libsql/client';
import { decodeHtmlEntities } from '../src/lib/html-entities';

const apply = process.argv.includes('--apply');
const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

(async () => {
  const res = await client.execute(`SELECT id, url FROM collected_data WHERE url LIKE '%&%;%'`);
  console.log(`候補 ${res.rows.length}件（url に "&…;" を含む行）`);

  const updates: { id: number; from: string; to: string }[] = [];
  const skipped: { id: number; url: string; why: string }[] = [];
  for (const r of res.rows as any[]) {
    const from = String(r.url ?? '');
    const to = decodeHtmlEntities(from).trim();
    if (to === from) continue;
    // 直した結果が http(s) でなくなる／制御文字が出るものは触らない（壊しにいかない）
    if (!/^https?:\/\//i.test(to) || /[\u0000-\u0020\u007f]/.test(to)) {
      skipped.push({ id: Number(r.id), url: from, why: !/^https?:\/\//i.test(to) ? 'http(s)でなくなる' : '制御文字' });
      continue;
    }
    updates.push({ id: Number(r.id), from, to });
  }

  console.log(`変更対象 ${updates.length}件 / 安全のため触らない ${skipped.length}件`);
  for (const s of skipped.slice(0, 10)) console.log(`  skip #${s.id} (${s.why}) ${s.url.slice(0, 80)}`);
  for (const u of updates.slice(0, 5)) {
    console.log(`  #${u.id}`);
    console.log(`    前 ${u.from.slice(0, 100)}`);
    console.log(`    後 ${u.to.slice(0, 100)}`);
  }

  if (!apply) {
    console.log('\nドライラン。実際に書き込むには --apply を付ける（本番DB変更なのでオーナーのGOを得てから）。');
    return;
  }

  // 一意制約に当たる可能性があるので1件ずつ。衝突したらその行は飛ばして続ける
  // （解いた結果が既存の正しいURLと重なる＝同じ記事が2行ある状態。消すかはオーナー判断）。
  let ok = 0, conflict = 0, failed = 0;
  for (const u of updates) {
    try {
      await client.execute({ sql: 'UPDATE collected_data SET url = ? WHERE id = ?', args: [u.to, u.id] });
      ok++;
    } catch (e: any) {
      if (/UNIQUE|constraint/i.test(String(e?.message))) { conflict++; continue; }
      failed++;
      console.warn(`  失敗 #${u.id}: ${String(e?.message).slice(0, 120)}`);
    }
  }
  console.log(`\n更新 ${ok}件 / 既存行と衝突して見送り ${conflict}件 / 失敗 ${failed}件`);
  if (conflict > 0) console.log('衝突分は「同じ記事が2行ある」状態。統合するかはオーナー判断（decisions.md 参照）。');
})();
