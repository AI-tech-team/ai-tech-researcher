import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskPII } from './pii';

test('メールアドレスを伏せる', () => {
  assert.equal(maskPII('連絡先は taro.yamada@example.co.jp です'), '連絡先は [email] です');
});

test('カード番号(4-4-4-4)を伏せる', () => {
  assert.equal(maskPII('4111 1111 1111 1111'), '[card]');
  assert.equal(maskPII('4111-1111-1111-1111'), '[card]');
});

test('電話番号(ハイフン)を伏せる', () => {
  assert.equal(maskPII('TEL 090-1234-5678'), 'TEL [phone]');
  assert.equal(maskPII('03-1234-5678'), '[phone]');
});

test('長い数字列(11桁以上)を伏せる', () => {
  assert.equal(maskPII('口座 12345678901'), '口座 [number]');
});

test('一般的な短い数字・文章は壊さない', () => {
  assert.equal(maskPII('GPT-4 の MMLU は 87.2 点、2026年の話'), 'GPT-4 の MMLU は 87.2 点、2026年の話');
  assert.equal(maskPII('エラーは route /api/collect で発生'), 'エラーは route /api/collect で発生');
});

test('null/undefined/空は空文字を返す', () => {
  assert.equal(maskPII(null), '');
  assert.equal(maskPII(undefined), '');
  assert.equal(maskPII(''), '');
});
