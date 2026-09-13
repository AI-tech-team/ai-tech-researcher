import test from 'node:test';
import assert from 'node:assert/strict';
import { topByVotes } from './collect-select';

const V = (n: number[]) => n.map((up, i) => ({ up, tag: `p${i}` }));

test('票の多い順に取る（APIの並びに従わない）', () => {
  // 2026-09-13 の実物の並び（先頭8件の外に上位が固まっていた）
  const items = V([28, 22, 26, 21, 25, 21, 22, 35, 27, 32, 47, 21, 29, 23, 28, 39, 24, 56, 27, 32, 251, 112, 28, 28, 205, 22, 55, 444, 20, 8]);
  const picked = topByVotes(items, p => p.up, 8);
  assert.deepEqual(picked.map(p => p.up), [444, 251, 205, 112, 56, 55, 47, 39]);
  assert.equal(picked[0].tag, 'p27', '27番目の筆頭論文を取りこぼさない');
});

test('同票は元の順を保つ（APIの並びを次の手がかりとして残す）', () => {
  const picked = topByVotes(V([10, 10, 10]), p => p.up, 2);
  assert.deepEqual(picked.map(p => p.tag), ['p0', 'p1']);
});

test('件数が上限より少なければ全部、空なら空。元の配列は壊さない', () => {
  const items = V([3, 1, 2]);
  assert.deepEqual(topByVotes(items, p => p.up, 10).map(p => p.up), [3, 2, 1]);
  assert.deepEqual(topByVotes([], (p: { up: number }) => p.up, 5), []);
  assert.deepEqual(items.map(p => p.up), [3, 1, 2], '呼び出し側の配列を並べ替えない');
});
