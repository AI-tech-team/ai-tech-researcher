import { SITE_URL, SITE_NAME, SITE_DESC } from '@/lib/site';
import { getReportsData } from '@/app/actions';

// 公開レポート(daily/weekly/monthly)の全文RSS 2.0フィード。メール配信と同じ中身を一本化。
// 配信ホットパスなのでCDNでサイドキャッシュ（getReportsData自体も60秒キャッシュ）。
// 法務: レポートは自前生成IPなので全文配信OK。記事(第三者著作)は混ぜない。

const TYPE_LABEL: Record<string, string> = { daily: 'デイリーレポート', weekly: '週次レポート', monthly: '月次レポート' };
const MAX_ITEMS = 50;

// XML/HTMLエスケープ（CDATA外のテキスト＝title等に使う）
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// CDATAに安全に埋め込む（"]]>" を割ってフィードを壊さない）
function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, ']]&gt;')}]]>`;
}

// インラインMarkdown → HTML文字列（Markdown.tsx の parseInline と同じトークン規則）。
// [ID:N] は記事ページへのリンクに、本文テキストは必ずエスケープしてから組み立てる。
function inlineHtml(text: string): string {
  const regex = /(\[ID:\d+\]|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out += esc(text.slice(last, m.index));
    const t = m[0];
    const idRef = t.match(/^\[ID:(\d+)\]$/);
    const link = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (idRef) {
      out += `<a href="${SITE_URL}/articles/${idRef[1]}">[#${idRef[1]}]</a>`;
    } else if (link) {
      const [, label, url] = link;
      // http(s)のみリンク化（javascript:等やグラウンディングのリダイレクトURLは弾く）
      if (/^https?:\/\//.test(url) && !url.includes('vertexaisearch.cloud.google.com')) {
        out += `<a href="${esc(url)}">${esc(label)}</a>`;
      } else {
        out += esc(label);
      }
    } else if (t.startsWith('**')) out += `<strong>${esc(t.slice(2, -2))}</strong>`;
    else if (t.startsWith('*')) out += `<em>${esc(t.slice(1, -1))}</em>`;
    else if (t.startsWith('`')) out += `<code>${esc(t.slice(1, -1))}</code>`;
    else out += esc(t);
    last = m.index + t.length;
  }
  if (last < text.length) out += esc(text.slice(last));
  return out;
}

// レポートMarkdown → RSS向けの軽量セマンティックHTML断片。
// メール用 markdownToHtml(api/report/route.ts) は暗色のフルHTML文書なのでフィードには使わない
// （RSSリーダは白背景でレンダリングするため、インライン暗色スタイルは付けない）。
function markdownToFeedHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    if (line.startsWith('### ')) { closeList(); out.push(`<h3>${inlineHtml(line.slice(4))}</h3>`); }
    else if (line.startsWith('## ')) { closeList(); out.push(`<h2>${inlineHtml(line.slice(3))}</h2>`); }
    else if (line.startsWith('# ')) { closeList(); out.push(`<h2>${inlineHtml(line.slice(2))}</h2>`); }
    else if (/^[-*] /.test(line)) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inlineHtml(line.slice(2))}</li>`);
    } else if (/^\d+\. /.test(line)) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inlineHtml(line.replace(/^\d+\.\s/, ''))}</li>`);
    } else if (line.startsWith('> ')) { closeList(); out.push(`<blockquote>${inlineHtml(line.slice(2))}</blockquote>`); }
    else if (/^[-*]{3,}$/.test(line) || /^={3,}$/.test(line)) { closeList(); out.push('<hr>'); }
    else if (!line.trim()) { closeList(); }
    else { closeList(); out.push(`<p>${inlineHtml(line)}</p>`); }
  }
  closeList();
  return out.join('\n');
}

// 本文先頭を素テキスト化した抜粋（<description>用）
function excerpt(md: string, max = 180): string {
  const text = md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\[ID:\d+\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// createdAt('YYYY-MM-DD HH:MM:SS'・UTC・空白区切り)→ RFC-822。無ければreportDate(JST日付)。
function rfc822(createdAt: string | null, reportDate: string): string {
  let d = createdAt ? new Date(createdAt.replace(' ', 'T') + 'Z') : new Date(NaN);
  if (isNaN(d.getTime())) d = new Date(reportDate + 'T00:00:00+09:00');
  if (isNaN(d.getTime())) d = new Date();
  return d.toUTCString();
}

export async function GET() {
  const reports = (await getReportsData()).slice(0, MAX_ITEMS);

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
