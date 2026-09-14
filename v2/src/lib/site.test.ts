import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstNonEmptyUrl, SITE_URL, SERVER_SITE_URL } from './site';

// ⚠ この関数が要る理由: GitHub Actions は未設定の secret を
//   `SITE_URL: ${{ secrets.SITE_URL }}` で渡すと **空文字**として環境に入れる。
//   `??` は空文字を「値あり」と見なすので既定値に落ちず、朝刊配信の
//   `new URL(siteUrl).hostname` が投げ、受信者ごとの try/catch に飲まれて
//   **全員分失敗しても `0/N件` と出るだけ**になる。
test('firstNonEmptyUrl: 空文字は「未設定」として扱う（??との違い）', () => {
  assert.equal(firstNonEmptyUrl('', 'https://cernoval.com'), 'https://cernoval.com');
  assert.equal(firstNonEmptyUrl('   ', 'https://cernoval.com'), 'https://cernoval.com');
  assert.equal(firstNonEmptyUrl(undefined, '', null, 'https://a.example'), 'https://a.example');
});

test('firstNonEmptyUrl: 先頭の有効な値を採る', () => {
  assert.equal(firstNonEmptyUrl('https://a.example', 'https://b.example'), 'https://a.example');
});

test('firstNonEmptyUrl: 末尾スラッシュを落とす', () => {
  assert.equal(firstNonEmptyUrl('https://cernoval.com/'), 'https://cernoval.com');
  assert.equal(firstNonEmptyUrl('https://cernoval.com///'), 'https://cernoval.com');
});

test('firstNonEmptyUrl: 全部空なら null', () => {
  assert.equal(firstNonEmptyUrl(), null);
  assert.equal(firstNonEmptyUrl('', undefined, null), null);
});

// 既定値が旧Vercelプロジェクトに戻らないための歯止め。あちらは削除予定。
test('既定のオリジンに旧プロジェクトのURLを使わない', () => {
  for (const u of [SITE_URL, SERVER_SITE_URL]) {
    assert.ok(!u.includes('ai-tech-researcher'), `${u} に旧プロジェクトのURLが残っている`);
    assert.ok(u.startsWith('https://'), `${u} は https で始まるべき`);
    assert.ok(!u.endsWith('/'), `${u} の末尾にスラッシュが残っている`);
  }
});
