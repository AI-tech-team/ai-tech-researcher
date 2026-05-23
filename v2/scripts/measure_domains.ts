/**
 * 検索(keyword)由来記事のドメイン分布を測る（フィード化の現実性確認）。
 * 実行: v2/ で `npx tsx scripts/measure_domains.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  const rows = (await client.execute({
    sql: `SELECT c.url AS url FROM collected_data c JOIN sources s ON c.source_id=s.id
           WHERE s.type='keyword' AND c.url IS NOT NULL`, args: [],
  })).rows;

  const domainCount = new Map<string, number>();
  let bad = 0;
  for (const r of rows as any[]) {
    try {
      const h = new URL(r.url).hostname.replace(/^www\./, '');
      domainCount.set(h, (domainCount.get(h) ?? 0) + 1);
    } catch { bad++; }
  }
  const sorted = [...domainCount.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`検索由来記事: ${rows.length}件 / 解析不能URL: ${bad}件`);
  console.log(`distinctドメイン数: ${domainCount.size}`);
  console.log(`\n上位ドメイン（フィード化候補）:`);
  for (const [d, c] of sorted.slice(0, 40)) {
    console.log(`  ${String(c).padStart(3)}件  ${d}`);
  }
  const singletons = sorted.filter(([, c]) => c === 1).length;
  console.log(`\n1件のみのドメイン(長尾): ${singletons} (${((singletons / domainCount.size) * 100).toFixed(0)}%)`);
  console.log(`2件以上のドメイン(常連): ${domainCount.size - singletons}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
