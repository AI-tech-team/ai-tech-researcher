import { SITE_URL, SITE_NAME, SITE_DESC } from '@/lib/site';
import { getReportsData } from '@/app/actions';
import { esc, markdownToFeedHtml, excerpt } from '@/lib/feed-markdown';

// 公開レポート(daily/weekly/monthly)の全文RSS 2.0フィード。メール配信と同じ中身を一本化。
// 配信ホットパスなのでCDNでサイドキャッシュ（getReportsData自体も60秒キャッシュ）。
// 法務: レポートは自前生成IPなので全文配信OK。記事(第三者著作)は混ぜない。

const TYPE_LABEL: Record<string, string> = { daily: 'デイリーレポート', weekly: '週次レポート', monthly: '月次レポート' };
const MAX_ITEMS = 50;


// CDATAに安全に埋め込む（"]]>" を割ってフィードを壊さない）
function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, ']]&gt;')}]]>`;
}


// createdAt('YYYY-MM-DD HH:MM:SS'・UTC・空白区切り)→ RFC-822。無ければreportDate(JST日付)。
function rfc822(createdAt: string | null, reportDate: string): string {
  let d = createdAt ? new Date(createdAt.replace(' ', 'T') + 'Z') : new Date(NaN);
  if (isNaN(d.getTime())) d = new Date(reportDate + 'T00:00:00+09:00');
  if (isNaN(d.getTime())) d = new Date();
  return d.toUTCString();
}

export async function GET() {
  // RSSは <content:encoded> に全文を載せるため contentChars=0（全文）で取得
  const reports = (await getReportsData(MAX_ITEMS, 0)).slice(0, MAX_ITEMS);

  // ⚠ 0件を 200 で返さない（2026-09-15・本番の読み取り枠切れ中に実測）。
  //   getReportsData は fail-open で [] を返すので、障害中でも **整形式で中身が空のRSS** が
  //   200 で出ていた（実測696バイト・<item>ゼロ・X-Vercel-Cache: HIT）。
  //   しかも下の lastBuildDate は「今」を刻むので、**空のフィードに新鮮だという判子を押している**。
  //   これは欠落ではなく積極的な嘘で、購読者には「Cernoval は何も出していない」と読める。
  //   さらにヘッダが s-maxage=1800 + stale-while-revalidate=86400 なので、
  //   **障害中のたった1回の取得が、復旧後も最大24時間そのまま配られ続ける**。
  //   画面と違って人間の目に触れないぶん、404よりたちが悪い（サイレントな消失）。
  //   公開レポートは313本あり 0件になる正常系は存在しないので、0件＝こちら側の異常と断定してよい。
  //   503 ならRSSリーダは手持ちを保持して後で取り直す＝こちらが望む挙動そのもの。
  if (reports.length === 0) {
    return new Response('feed temporarily unavailable', {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '1800',
      },
    });
  }

  const items = reports.map(r => {
    const label = TYPE_LABEL[r.type] ?? 'レポート';
    const title = `${label} ${r.reportDate}`;
    const url = `${SITE_URL}/reports/${r.id}`;
    const content = r.content ?? '';
    return [
      '    <item>',
      `      <title>${esc(title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${rfc822(r.createdAt, r.reportDate)}</pubDate>`,
      `      <category>${esc(label)}</category>`,
      `      <description>${cdata(excerpt(content))}</description>`,
      `      <content:encoded>${cdata(markdownToFeedHtml(content))}</content:encoded>`,
      '    </item>',
    ].join('\n');
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE_NAME)} — レポート</title>
    <link>${SITE_URL}</link>
    <description>${esc(SITE_DESC)}</description>
    <language>ja</language>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>${esc(SITE_NAME)}</generator>
    <ttl>30</ttl>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      // CDNで30分キャッシュ＋失効後も古い版を返しつつ裏で再生成（配信課金・レイテンシ削減）
      'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
    },
  });
}

