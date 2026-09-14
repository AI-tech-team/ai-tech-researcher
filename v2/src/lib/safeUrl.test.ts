import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeFetchUrl, safeHttpUrl } from './safeUrl';

// SSRFガード: 公開http(s)は許可、内部/プライベート/メタデータ/非http(s)は拒否する。
test('isSafeFetchUrl: 公開URLは許可', () => {
  assert.equal(isSafeFetchUrl('https://example.com/path'), true);
  assert.equal(isSafeFetchUrl('http://example.com'), true);
});

test('isSafeFetchUrl: 内部/プライベート/メタデータ宛は拒否(SSRF)', () => {
  for (const u of [
    'http://localhost:3000',
    'http://127.0.0.1/x',
    'http://10.0.0.5',
    'http://192.168.1.1',
    'http://172.16.0.1',
    'http://169.254.169.254/latest/meta-data', // クラウドメタデータ
    'http://metadata.google.internal',
    'http://[::1]/',
  ]) {
    assert.equal(isSafeFetchUrl(u), false, `should block ${u}`);
  }
});

test('isSafeFetchUrl: 非http(s)スキーム/空は拒否', () => {
  assert.equal(isSafeFetchUrl('ftp://example.com'), false);
  assert.equal(isSafeFetchUrl('javascript:alert(1)'), false);
  assert.equal(isSafeFetchUrl('file:///etc/passwd'), false);
  assert.equal(isSafeFetchUrl(''), false);
  assert.equal(isSafeFetchUrl(null), false);
  assert.equal(isSafeFetchUrl('not a url'), false);
});

// XSSガード: hrefに使う前にhttp(s)以外と期限切れグラウンディングURLを弾く。
test('safeHttpUrl: 危険スキームはnull、正常はそのまま', () => {
  assert.equal(safeHttpUrl('https://x.com/a'), 'https://x.com/a');
  assert.equal(safeHttpUrl('http://x.com'), 'http://x.com');
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,<script>1</script>'), null);
  assert.equal(safeHttpUrl('https://vertexaisearch.cloud.google.com/redirect'), null);
  assert.equal(safeHttpUrl(null), null);
  assert.equal(safeHttpUrl(''), null);
});

// ── 2026-09-15: 本番2,083件(8.8%)のURLにHTMLエンティティが生で残っていた回帰 ──
// `#` はフラグメント開始なので、ブラウザは実測で **404ではなくHTTP 200の無関係な記事**へ飛んだ。
// 静かに間違った場所へ運ぶので、リンク切れより害が大きい。
test('ハイフンの数値参照を解いて本来の記事URLに戻す（gigazineの実データ）', () => {
  assert.equal(
    safeHttpUrl('https://gigazine.net/news/20260722&#45;block&#45;buzz/'),
    'https://gigazine.net/news/20260722-block-buzz/',
  );
});

test('クエリの &#038; を & に戻す（futurumgroupの実データ）', () => {
  assert.equal(
    safeHttpUrl('https://futurumgroup.com/insights/x/?utm_source=rss&#038;utm_medium=rss'),
    'https://futurumgroup.com/insights/x/?utm_source=rss&utm_medium=rss',
  );
});

test('エンティティを解いてから検査するので危険スキームは隠せない', () => {
  assert.equal(safeHttpUrl('&#106;avascript:alert(1)'), null);
  assert.equal(safeHttpUrl('&#100;ata:text/html,<script>'), null);
});

test('解いた結果に制御文字が現れたら弾く', () => {
  assert.equal(safeHttpUrl('https://example.com/&#10;x'), null);
  assert.equal(safeHttpUrl('https://example.com/&#9;x'), null);
});

test('エンティティを含まない普通のURLは1文字も変えない', () => {
  const u = 'https://example.com/a/b?c=1&d=2#frag';
  assert.equal(safeHttpUrl(u), u);
});
