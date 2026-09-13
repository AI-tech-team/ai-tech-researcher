import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalAt, describeAlignment, INDEX_RULE } from './eval-align';

// 本番で起きた形そのまま: 候補3件に対し、LLMが順序を1つずつ回して返した。
const CANDIDATES = ['ActReview', '多言語の架け橋', 'Adaptive Bridge'];
const ROTATED = [
  { index: 2, summary: 'ROS 2のDDSバックプレッシャーを解決するAdaptive Bridge' },
  { index: 0, summary: '行動指向のピアレビュー生成タスクを定義し…' },
  { index: 1, summary: 'In-Language Reasoningのデータ混合…' },
];

test('順序が入れ替わっても index で正しい評価を引く', () => {
  assert.equal(evalAt(ROTATED, 0)?.summary, '行動指向のピアレビュー生成タスクを定義し…');
  assert.equal(evalAt(ROTATED, 1)?.summary, 'In-Language Reasoningのデータ混合…');
  assert.equal(evalAt(ROTATED, 2)?.summary, 'ROS 2のDDSバックプレッシャーを解決するAdaptive Bridge');
});

test('位置対応だと実際にズレる（この不具合が起きたことの再現）', () => {
  // 旧実装 evaluations[i] は候補0番に「Adaptive Bridge の要約」を付けていた
  assert.notEqual(ROTATED[0].summary, evalAt(ROTATED, 0)?.summary);
  assert.equal(CANDIDATES.length, ROTATED.length, '件数は一致している＝件数チェックでは気づけない');
});

test('index が無ければ位置に落ちる（全件捨てない）', () => {
  const noIdx: { index?: number; summary: string }[] = [{ summary: 'a' }, { summary: 'b' }, { summary: 'c' }];
  assert.equal(evalAt(noIdx, 0)?.summary, 'a');
  assert.equal(evalAt(noIdx, 2)?.summary, 'c');
});

test('空・undefined・範囲外でも落ちない', () => {
  assert.equal(evalAt([], 0), undefined);
  assert.equal(evalAt(undefined, 0), undefined);
  assert.equal(evalAt(null, 3), undefined);
  assert.equal(evalAt(ROTATED, 99), undefined);
});

test('件数が足りない返り値でも、返ってきた分は正しく引ける', () => {
  const partial = [{ index: 2, summary: 'c' }];
  assert.equal(evalAt(partial, 2)?.summary, 'c');
  assert.equal(evalAt(partial, 1), undefined, '1番の評価は無いので undefined（誤って c を付けない）');
});

test('describeAlignment は黙ってフォールバックした事実を見せる', () => {
  assert.match(describeAlignment(ROTATED, 3), /index で対応（3\/3件）/);
  assert.match(describeAlignment([{ summary: 'a' }] as { index?: number; summary: string }[], 3), /index なし/);
  assert.match(describeAlignment([{ index: 0 }, { index: 0 }], 3), /重複/);
  assert.match(describeAlignment([{ index: 0 }, { index: 9 }], 3), /範囲外/);
});

test('INDEX_RULE は index を返させる指示を含む', () => {
  assert.match(INDEX_RULE, /index/);
  assert.match(INDEX_RULE, /\[番号\]/);
});
