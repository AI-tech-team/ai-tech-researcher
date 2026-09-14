import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalAt, describeAlignment, INDEX_RULE, acceptKnownIds, describeIdMatch } from './eval-align';

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

// ── acceptKnownIds: モデルが返した id を主キーとして信じない ──────────────
// translateTitles などは渡した25件を `[id] 題` の形で見せ、items[].id で返させている。
// 渡していない id が返れば、無関係な記事の summary / keyPoints を消す UPDATE になる。

test('渡した id だけを通す', () => {
  const r = acceptKnownIds([{ id: 21984 }, { id: 999999 }, { id: 21985 }], [21984, 21985, 21986]);
  assert.deepEqual(r.ok.map(x => x.id), [21984, 21985]);
  assert.equal(r.unknown, 1);
  assert.equal(r.duplicated, 0);
});

test('同じ id が2回返ったら両方捨てる（黙って最後が勝つのを防ぐ）', () => {
  const r = acceptKnownIds(
    [{ id: 7, v: 'A' }, { id: 8, v: 'B' }, { id: 7, v: 'C' }],
    [7, 8],
  );
  assert.deepEqual(r.ok.map(x => x.id), [8]);
  assert.equal(r.duplicated, 1);
});

test('id が数値でない・null の要素は通さない', () => {
  const r = acceptKnownIds([null as any, { id: '7' } as any, { id: 7 }], [7]);
  assert.deepEqual(r.ok.map(x => x.id), [7]);
  assert.equal(r.unknown, 2);
});

test('空・未定義でも落ちない', () => {
  assert.deepEqual(acceptKnownIds(null, [1]).ok, []);
  assert.deepEqual(acceptKnownIds(undefined, [1]).ok, []);
  assert.deepEqual(acceptKnownIds([], [1]).ok, []);
});

test('問題が無いときログ文字列は空（正常時にログを汚さない）', () => {
  assert.equal(describeIdMatch({ unknown: 0, duplicated: 0 }), '');
  assert.match(describeIdMatch({ unknown: 2, duplicated: 0 }), /渡していないid 2件/);
  assert.match(describeIdMatch({ unknown: 0, duplicated: 1 }), /重複id 1種/);
});
