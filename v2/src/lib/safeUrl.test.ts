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
