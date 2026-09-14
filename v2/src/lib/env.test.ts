import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstNonEmpty } from './env';

// 環境変数には「未設定」と「空文字」の2通りがあり、`??` は空文字を通す。
// GitHub Actions は未設定の secret を空文字として渡すので、この差が本番の壊れ方に直結する。
test('firstNonEmpty: 空文字・空白のみは未設定として扱う', () => {
  assert.equal(firstNonEmpty('', 'b'), 'b');
  assert.equal(firstNonEmpty('   ', 'b'), 'b');
  assert.equal(firstNonEmpty(undefined, null, '', 'b'), 'b');
});

test('firstNonEmpty: 先頭の有効な値を採り、前後の空白は落とす', () => {
  assert.equal(firstNonEmpty('  a  ', 'b'), 'a');
  assert.equal(firstNonEmpty('a', 'b'), 'a');
});

test('firstNonEmpty: 全部空なら null', () => {
  assert.equal(firstNonEmpty(), null);
  assert.equal(firstNonEmpty('', '  ', undefined, null), null);
});

// ⚠ `??` との違いを固定しておく。この差を忘れると同じ事故が戻る。
test('firstNonEmpty は ?? と違う結果になる（これが直した理由）', () => {
  const empty = '';
  assert.equal(empty ?? 'fallback', '');              // ?? は空文字を通してしまう
  assert.equal(firstNonEmpty(empty, 'fallback'), 'fallback');
});
