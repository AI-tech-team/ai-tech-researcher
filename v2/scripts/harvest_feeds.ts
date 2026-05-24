/**
 * v4 遡及収穫: 既存の検索(keyword)由来・高品質記事のドメインからRSS/Atomを発見し、
 * 無料フィード(rss/candidate)として登録する。検索が見つけたドメインを一括フィード化。
 * 実行: v2/ で `npx tsx scripts/harvest_feeds.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { discoverFeedUrl } from '../src/lib/feeds';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

const DOMAIN_SKIP = new Set([
  'google.com', 'youtube.com', 'wikipedia.org', 't.co', 'twitter.com', 'x.com',
  'instagram.com', 'facebook.com', 'linkedin.com', 'techdrip.net', 'github.com',
  'medium.com', 'reddit.com', 'substack.com', 'arxiv.org', 'huggingface.co',
  'vertexaisearch.cloud.google.com',
]);

const CONCURRENCY = 6;

async function main() {
  // 検索由来 or 高品質(>=7)の記事ドメインを候補にする
  const rows = (await client.execute({
    sql: `SELECT DISTINCT c.url AS url FROM collected_data c JOIN sources s ON c.source_id=s.id
           WHERE c.url IS NOT NULL AND (s.type='keyword' OR c.importance_score >= 7)`, args: [],
  })).rows;

  // 既に巡回中のフィードのhostname集合
  const srcRows = (await client.execute({ sql: `SELECT value FROM sources`, args: [] })).rows;
  const feedHosts = new Set<string>();
  for (const r of srcRows as any[]) {
    try { if (String(r.value).startsWith('http')) feedHosts.add(new URL(r.value).hostname.replace(/^www\./, '')); } catch { }
  }

  const domains = new Set<string>();
  for (const r of rows as any[]) {
    try {
      const h = new URL(r.url).hostname.replace(/^www\./, '');
      if (DOMAIN_SKIP.has(h) || feedHosts.has(h)) continue;
      domains.add(h);
    } catch { }
  }
  const domainList = [...domains];
  console.log(`探索対象ドメイン: ${domainList.length}件\n`);

  let added = 0, found = 0;
  // 簡易並列プール
  for (let i = 0; i < domainList.length; i += CONCURRENCY) {
    const batch = domainList.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async d => ({ d, feed: await discoverFeedUrl(d) })));
    for (const { d, feed } of results) {
      if (!feed) { console.log(`  ✗ ${d}`); continue; }
      found++;
      try {
        const r = await client.execute({
          sql: `INSERT OR IGNORE INTO sources (type, value, status, score) VALUES ('rss', ?, 'active', 3)`,
          args: [feed],
        });
        if (r.rowsAffected > 0) { added++; console.log(`  ✓ ${d} → ${feed}`); }
        else console.log(`  = ${d} → ${feed} (登録済)`);
      } catch (e: any) { console.log(`  ! ${d} → ${feed} (登録失敗: ${e.message})`); }
    }
  }
  console.log(`\nフィード発見: ${found}件 / 新規登録: ${added}件`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
