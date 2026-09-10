// ケースは 2026-09-10 の監査で「旧実装が取りこぼしていた実物の robots.txt」から取っている。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isPathAllowed } from './robots-rules';

const UA = 'cernoval';

test('全面禁止（Reddit）を検出する', () => {
  const r = parseRobots('User-agent: *\nDisallow: /', UA);
  assert.equal(isPathAllowed(r.rules, '/r/LocalLLaMA/'), false);
  assert.equal(isPathAllowed(r.rules, '/'), false);
});

test('ワイルドカードを解釈する（旧実装は永久にマッチしなかった）', () => {
  // Wired 型: クエリ付きURLの禁止
  const w = parseRobots('User-agent: *\nDisallow: /*?', UA);
  assert.equal(isPathAllowed(w.rules, '/story/foo'), true);
  assert.equal(isPathAllowed(w.rules, '/story/foo?utm=1'), false, 'パスにクエリを含めて渡す約束');

  // GIGAZINE 型: 階層の途中にワイルドカード
  const g = parseRobots('User-agent: *\nDisallow: /news/*/*/', UA);
  assert.equal(isPathAllowed(g.rules, '/news/20260910/ai/'), false);
  assert.equal(isPathAllowed(g.rules, '/news/index.html'), true);
});

test('末尾 $ は終端を意味する', () => {
  const r = parseRobots('User-agent: *\nDisallow: /*.pdf$', UA);
  assert.equal(isPathAllowed(r.rules, '/docs/a.pdf'), false);
  assert.equal(isPathAllowed(r.rules, '/docs/a.pdf.html'), true);
});

test('Allow は最長一致で Disallow に勝つ', () => {
  const r = parseRobots('User-agent: *\nDisallow: /private/\nAllow: /private/public/', UA);
  assert.equal(isPathAllowed(r.rules, '/private/secret'), false);
  assert.equal(isPathAllowed(r.rules, '/private/public/ok'), true, '例外許可を読めないと取れるものを取り逃す');
});

test('同じ長さなら Allow を優先する（RFC9309）', () => {
  const r = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a', UA);
  assert.equal(isPathAllowed(r.rules, '/a/b'), true);
});

test('自分宛のグループがあれば * のグループは使わない', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: Cernoval\nDisallow: /admin/';
  const r = parseRobots(txt, UA);
  assert.equal(isPathAllowed(r.rules, '/articles/1'), true, '自分は許可されている');
  assert.equal(isPathAllowed(r.rules, '/admin/x'), false);
});

test('連続する User-agent 行は同じグループを共有する', () => {
  const txt = 'User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nDisallow: /tmp/';
  const r = parseRobots(txt, UA);
  assert.equal(isPathAllowed(r.rules, '/articles/1'), true, '他社宛の全面禁止を自分に適用しない');
  assert.equal(isPathAllowed(r.rules, '/tmp/x'), false);
});

test('Crawl-delay を読む（GIGAZINE は 100 を明示している）', () => {
  assert.equal(parseRobots('User-agent: *\nCrawl-delay: 100\nDisallow:', UA).crawlDelayMs, 100_000);
  assert.equal(parseRobots('User-agent: *\nDisallow:', UA).crawlDelayMs, null);
});

test('空 Disallow は「制限なし」で、規則として数えない', () => {
  const r = parseRobots('User-agent: *\nDisallow:', UA);
  assert.deepEqual(r.rules, []);
  assert.equal(isPathAllowed(r.rules, '/anything'), true);
});

test('コメントと未知フィールドを無視する', () => {
  const r = parseRobots('# hi\nUser-agent: *   # all\nSitemap: https://x/sitemap.xml\nDisallow: /x', UA);
  assert.equal(isPathAllowed(r.rules, '/x/y'), false);
  assert.equal(isPathAllowed(r.rules, '/y'), true);
});

test('正規表現メタ文字を含むパスで壊れない', () => {
  const r = parseRobots('User-agent: *\nDisallow: /a+b(c)/', UA);
  assert.equal(isPathAllowed(r.rules, '/a+b(c)/d'), false);
  assert.equal(isPathAllowed(r.rules, '/aaab/d'), true, 'メタ文字がエスケープされている');
});

test('robots.txt が空なら全許可', () => {
  const r = parseRobots('', UA);
  assert.equal(isPathAllowed(r.rules, '/'), true);
});
