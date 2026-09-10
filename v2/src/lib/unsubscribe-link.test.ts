import { test } from 'node:test';
import assert from 'node:assert/strict';

// secret() は呼び出し時に env を読むので、静的importでも先にここで設定しておけば足りる
process.env.AUTH_SECRET = 'test-secret-for-unit-tests';
import { makeUnsubSig, verifyUnsubSig, unsubscribeUrl } from './unsubscribe-link';

test('同じ userId には同じ署名が出る（メール再送でリンクが変わらない）', () => {
  assert.equal(makeUnsubSig('u1'), makeUnsubSig('u1'));
  assert.equal(makeUnsubSig('u1').length, 32);
});

test('別の userId の署名は使えない', () => {
  assert.equal(verifyUnsubSig('u1', makeUnsubSig('u1')), true);
  assert.equal(verifyUnsubSig('u2', makeUnsubSig('u1')), false);
});

test('壊れた入力は false（例外を投げない）', () => {
  assert.equal(verifyUnsubSig('u1', ''), false);
  assert.equal(verifyUnsubSig('', makeUnsubSig('u1')), false);
  assert.equal(verifyUnsubSig('u1', 'short'), false);
  assert.equal(verifyUnsubSig('u1', 'x'.repeat(32)), false);
});

test('URLに userId と署名が載り、末尾スラッシュを重ねない', () => {
  const url = unsubscribeUrl('https://cernoval.com/', 'u1');
  assert.equal(url, `https://cernoval.com/api/unsubscribe?u=u1&s=${makeUnsubSig('u1')}`);
});

test('userId をURLエンコードする', () => {
  assert.ok(unsubscribeUrl('https://cernoval.com', 'a b/c').includes('u=a%20b%2Fc'));
});
