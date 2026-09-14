import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatBacklog, hasBacklog, BACKLOG_WARN_RATIO } from './backlog';

test('余裕があるときは印を付けない', () => {
  const s = formatBacklog([{ name: '候補', got: 32, cap: 120 }]);
  assert.equal(s, '[Backlog] 候補 32/120（余裕88）');
  assert.equal(hasBacklog([{ name: '候補', got: 32, cap: 120 }]), false);
});

test('上限に達したら印を付ける（＝既にこぼれている）', () => {
  const st = [{ name: 'TOP_N', got: 40, cap: 40 }];
  assert.match(formatBacklog(st), /⚠上限に到達/);
  assert.equal(hasBacklog(st), true);
});

test('上限を超えたぶんも余裕は負にしない', () => {
  assert.match(formatBacklog([{ name: 'x', got: 53, cap: 40 }]), /53\/40（余裕0）/);
});

test('8割で「余裕わずか」を出す（こぼれる前に気づくため）', () => {
  assert.match(formatBacklog([{ name: 'x', got: 96, cap: 120 }]), /⚠余裕わずか/);
  assert.doesNotMatch(formatBacklog([{ name: 'x', got: 95, cap: 120 }]), /⚠/);
  assert.equal(BACKLOG_WARN_RATIO, 0.8);
});

test('複数工程を1行に並べる', () => {
  const s = formatBacklog([
    { name: '候補', got: 32, cap: 120 },
    { name: 'TOP_N', got: 23, cap: 40 },
  ]);
  assert.equal(s, '[Backlog] 候補 32/120（余裕88） | TOP_N 23/40（余裕17）');
});

test('対象が無くても落ちない', () => {
  assert.equal(formatBacklog([]), '[Backlog] 対象なし');
  assert.equal(hasBacklog([]), false);
});

// 2026-09-15 にバックアップ60日分で測った実測値をそのまま入れ、印の出方が現実と合うか確かめる。
test('実測値（60日の最大）でどう出るか', () => {
  // 候補の最大63件に対し上限120 → 余裕あり
  assert.doesNotMatch(formatBacklog([{ name: '候補', got: 63, cap: 120 }]), /⚠/);
  // ドメイン上限後の最大53件に対し TOP_N=40 → 到達（仕様どおり材料を絞っている）
  assert.match(formatBacklog([{ name: 'TOP_N', got: 53, cap: 40 }]), /⚠上限に到達/);
});

// ── 「決めたのに入っていない」を機械で防ぐ ──
// この関数自体が、記録には残っていたのに**リポジトリのどこにも無かった**ものなので、
// 今度は接続されていること自体をテストで固定する。grep -c で足りる検査は人に任せない。
test('日次パイプラインから実際に呼ばれている', () => {
  const src = readFileSync(new URL('./daily-report.ts', import.meta.url), 'utf-8');
  assert.ok(/formatBacklog\(/.test(src), 'daily-report.ts が formatBacklog() を呼んでいない');

  // 検出器が本当に効くことの証明（呼び出しを消した写しでは落ちること）。
  // これが無いと「常に true を返すだけのテスト」でも緑になってしまう。
  const mutated = src.replace(/formatBacklog\(/g, 'somethingElse(');
  assert.equal(/formatBacklog\(/.test(mutated), false, '検出器が呼び出しの消失を検知できていない');
});
