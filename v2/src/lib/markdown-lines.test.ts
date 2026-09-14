import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BULLET_LINE, HR_LINE, bulletContent } from './markdown-lines';

test('LLMが出す `*   ` 記法を箇条書きと判定する（本番143号中138号がこの形）', () => {
  assert.equal(bulletContent('*   **何が起きたか**: 本文'), '**何が起きたか**: 本文');
});

test('ハイフンも従来どおり', () => {
  assert.equal(bulletContent('- ひとつ'), 'ひとつ');
  assert.equal(bulletContent('+ みっつ'), 'みっつ');
});

test('字下げした入れ子も拾う（5月の号の記法）', () => {
  assert.equal(bulletContent('    * **実践的ヒント:** 本文'), '**実践的ヒント:** 本文');
});

test('深すぎる字下げは吸い込まない', () => {
  assert.equal(bulletContent('        * 深い'), null);
});

test('記号の後に空白が無ければ箇条書きではない', () => {
  assert.equal(bulletContent('---'), null);
  assert.equal(bulletContent('*強調*'), null);
  assert.equal(bulletContent('-1度'), null);
});

test('水平線は --- *** ___ === を3つ以上、その行だけ', () => {
  for (const s of ['---', '****', '___', '====']) assert.ok(HR_LINE.test(s), s);
  for (const s of ['- ', '-- ', '--- あ', ' ---']) assert.ok(!HR_LINE.test(s), s);
});

test('箇条書きと水平線は同時に成立しない（判定の順序に依存させない）', () => {
  for (const s of ['---', '***', '- ひとつ', '*   本文', '    * 入れ子']) {
    assert.ok(!(BULLET_LINE.test(s) && HR_LINE.test(s)), s);
  }
});

test('g フラグを持たない（.test と .replace の併用で状態を持たない）', () => {
  assert.equal(BULLET_LINE.global, false);
  assert.equal(HR_LINE.global, false);
  // 同じ文字列を2回テストしても結果が変わらないこと
  assert.equal(BULLET_LINE.test('- x'), BULLET_LINE.test('- x'));
});
