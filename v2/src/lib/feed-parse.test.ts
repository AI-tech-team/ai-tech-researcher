import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedItems, filterByDate } from './feed-parse';

// 本番で実際に巡回している3形式の実物を縮めたもの。
// ⚠ 形式ごとに1本ずつ置くこと。RDF が抜けていたせいで `<item rdf:about>` を1件も拾えない
//   バグが数か月見つからなかった（本番2フィード×計55件/日が不可視）。

const RSS2 = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>TechCrunch</title>
<item>
  <title>OpenAI&#8217;s Sam Altman says it would be ill-advised</title>
  <link>https://techcrunch.com/2026/09/12/altman/</link>
  <description><![CDATA[<p>Altman said <b>something</b>.</p>]]></description>
  <pubDate>Sat, 12 Sep 2026 20:19:16 +0000</pubDate>
</item>
<item>
  <title>Anthropic CEO outlines plan</title>
  <link>https://techcrunch.com/2026/09/01/anthropic/</link>
  <description>Plain text.</description>
  <pubDate>Tue, 01 Sep 2026 19:34:44 +0000</pubDate>
</item>
</channel></rss>`;

// RSS 1.0 / RDF。開始タグに属性が付き、日付は dc:date。これが落ちていた。
const RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://japan.cnet.com/"><title>CNET Japan</title></channel>
<item rdf:about="https://japan.cnet.com/article/35252569/">
  <title>Amazon、「ChatGPT」に広告を配信</title>
  <link>https://japan.cnet.com/article/35252569/</link>
  <description>AIで商品探しのニーズに対応</description>
  <dc:date>2026-09-13T10:01:00+09:00</dc:date>
</item>
<item rdf:about="https://japan.cnet.com/article/35252567/">
  <title>Anthropic CEOの回答</title>
  <link>https://japan.cnet.com/article/35252567/</link>
  <description>米国がAI開発を減速</description>
  <dc:date>2026-08-01T07:59:00+09:00</dc:date>
</item>
</rdf:RDF>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>calv.info</title>
<entry>
  <title>Small Models Have Arrived</title>
  <link rel="alternate" href="https://calv.info/small-models-have-arrived"/>
  <summary>A note about &amp; small models.</summary>
  <updated>2026-08-26T12:00:00.000Z</updated>
</entry>
</feed>`;

test('RSS 2.0: title/link/description/pubDate を取る', () => {
  const items = parseFeedItems(RSS2);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'OpenAI’s Sam Altman says it would be ill-advised', 'HTMLエンティティを解く');
  assert.equal(items[0].link, 'https://techcrunch.com/2026/09/12/altman/');
  assert.equal(items[0].description, 'Altman said something.', 'CDATAを剥がしタグを落とす');
  assert.equal(items[0].pubDate, 'Sat, 12 Sep 2026 20:19:16 +0000');
});

// このテストが無かったせいで、本番2フィードが数か月「0件成功」を返しつづけた。
test('RDF: <item rdf:about="..."> を拾い、日付は dc:date から取る', () => {
  const items = parseFeedItems(RDF);
  assert.equal(items.length, 2, '開始タグの属性を許さないと0件になる');
  assert.equal(items[0].title, 'Amazon、「ChatGPT」に広告を配信');
  assert.equal(items[0].link, 'https://japan.cnet.com/article/35252569/');
  assert.equal(items[0].pubDate, '2026-09-13T10:01:00+09:00', 'pubDate が無くても dc:date を使う');
});

test('Atom: <link href> と <updated> を取る', () => {
  const items = parseFeedItems(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://calv.info/small-models-have-arrived');
  assert.equal(items[0].description, 'A note about & small models.');
  assert.equal(items[0].pubDate, '2026-08-26T12:00:00.000Z');
});

test('title か link が欠けた項目は捨てる', () => {
  const xml = '<rss><channel><item><title>見出しだけ</title></item>'
    + '<item><link>https://example.com/a</link></item>'
    + '<item><title>両方ある</title><link>https://example.com/b</link></item></channel></rss>';
  const items = parseFeedItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://example.com/b');
});

test('壊れた入力でも例外を投げず空を返す', () => {
  for (const s of ['', '   ', 'ただのテキスト', '<rss></rss>', '<item>閉じていない']) {
    assert.deepEqual(parseFeedItems(s), [], JSON.stringify(s));
  }
});

test('filterByDate: 窓の外を落とす。dc:date も効く', () => {
  const since = new Date('2026-09-06T00:00:00Z').getTime();
  assert.equal(filterByDate(parseFeedItems(RSS2), since).length, 1, '09-01の記事は落ちる');
  assert.equal(filterByDate(parseFeedItems(RDF), since).length, 1, 'dc:date=08-01 の記事は落ちる');
});

test('filterByDate: 日付が無い／壊れているものは落とさない（静かな欠落を作らない）', () => {
  const since = new Date('2026-09-06T00:00:00Z').getTime();
  const items = [
    { title: 'a', link: 'https://e.com/a', description: '', pubDate: '' },
    { title: 'b', link: 'https://e.com/b', description: '', pubDate: 'めちゃくちゃな日付' },
  ];
  assert.equal(filterByDate(items, since).length, 2);
});
