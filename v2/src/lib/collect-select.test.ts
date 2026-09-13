import test from 'node:test';
import assert from 'node:assert/strict';
import { topByScore } from './collect-select';

const V = (n: number[]) => n.map((up, i) => ({ up, tag: `p${i}` }));

test('票の多い順に取る（APIの並びに従わない）', () => {
  // 2026-09-13 の実物の並び（先頭8件の外に上位が固まっていた）
  const items = V([28, 22, 26, 21, 25, 21, 22, 35, 27, 32, 47, 21, 29, 23, 28, 39, 24, 56, 27, 32, 251, 112, 28, 28, 205, 22, 55, 444, 20, 8]);
  const picked = topByScore(items, p => p.up, 8);
  assert.deepEqual(picked.map(p => p.up), [444, 251, 205, 112, 56, 55, 47, 39]);
  assert.equal(picked[0].tag, 'p27', '27番目の筆頭論文を取りこぼさない');
});

test('同票は元の順を保つ（APIの並びを次の手がかりとして残す）', () => {
  const picked = topByScore(V([10, 10, 10]), p => p.up, 2);
  assert.deepEqual(picked.map(p => p.tag), ['p0', 'p1']);
});

test('件数が上限より少なければ全部、空なら空。元の配列は壊さない', () => {
  const items = V([3, 1, 2]);
  assert.deepEqual(topByScore(items, p => p.up, 10).map(p => p.up), [3, 2, 1]);
  assert.deepEqual(topByScore([], (p: { up: number }) => p.up, 5), []);
  assert.deepEqual(items.map(p => p.up), [3, 1, 2], '呼び出し側の配列を並べ替えない');
});

// ── HN: 順位はスコア順ではない（2026-09-13 top150 の実物）──────────────
test('HN: 順位でなくスコアで取る（打ち切ると▲1191を落として▲129を拾う）', () => {
  const hn = [
    { rank: 1, s: 129 }, { rank: 5, s: 224 }, { rank: 8, s: 457 }, { rank: 12, s: 388 },
    { rank: 21, s: 131 }, { rank: 40, s: 1191 }, { rank: 45, s: 112 }, { rank: 58, s: 226 },
    { rank: 118, s: 932 }, { rank: 132, s: 181 }, { rank: 134, s: 345 }, { rank: 139, s: 666 },
    { rank: 147, s: 123 },
  ];
  const oldWay = hn.slice(0, 5);                       // 「5件見つけたら break」
  const newWay = topByScore(hn, h => h.s, 5);
  assert.deepEqual(oldWay.map(h => h.s), [129, 224, 457, 388, 131]);
  assert.deepEqual(newWay.map(h => h.s), [1191, 932, 666, 457, 388]);
  assert.ok(newWay.every(h => h.s >= 388), '上位5件が全て▲388以上になる');
});

// ── RSS: フィードが新しい順に並んでいる保証は無い（NVIDIA Developer は最新が2番目）──
const D = (s: string) => new Date(s).getTime();
test('RSS: 並びでなく日付で取る（最新が先頭に無いフィードを落とさない）', () => {
  const feed = [
    { t: 'a', d: '2026-09-11T00:00:00Z' },
    { t: 'b', d: '2026-09-10T00:00:00Z' },
    { t: 'c', d: '2026-09-13T00:00:00Z' }, // 最新が2番目にいる
    { t: 'd', d: '2026-09-12T00:00:00Z' },
  ];
  assert.deepEqual(topByScore(feed, f => D(f.d), 2).map(f => f.t), ['c', 'd']);
});

test('RSS: 日付が読めない項目があっても落ちず、全部読めなければ元の並びのまま', () => {
  const mixed = [{ t: 'x', d: '' }, { t: 'y', d: '2026-09-12T00:00:00Z' }];
  assert.deepEqual(topByScore(mixed, f => D(f.d), 2).map(f => f.t), ['y', 'x'], '日付なしは後ろへ');
  const undated = [{ t: 'p', d: '' }, { t: 'q', d: 'not a date' }, { t: 'r', d: '' }];
  assert.deepEqual(topByScore(undated, f => D(f.d), 3).map(f => f.t), ['p', 'q', 'r']);
});
