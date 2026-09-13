import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDerivativeModel, baseModelKey, dedupeByBaseModel } from './model-id';

// 2026-09-13 の HF trending 実物
const REAL = [
  'deepseek-ai/DeepSeek-V4.1-Flash',
  'openbmb/MiniCPM5-2B',
  'Qwen/Qwen3.8-27B',
  'ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF',
  'unsloth/Qwen3.8-27B-GGUF',
  'openbmb/MiniCPM5-2B-GGUF',
  'dealignai/GLM-5.3-CYBERSECURITY-FP8',
  'Lightricks/LTX-2.5',
];

test('量子化・変換版を名前の印で見分ける', () => {
  assert.equal(isDerivativeModel('unsloth/Qwen3.8-27B-GGUF'), true);
  assert.equal(isDerivativeModel('ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF'), true);
  assert.equal(isDerivativeModel('dealignai/GLM-5.3-CYBERSECURITY-FP8'), true);
  assert.equal(isDerivativeModel('Qwen/Qwen3.8-27B'), false);
  assert.equal(isDerivativeModel('deepseek-ai/DeepSeek-V4.1-Flash'), false);
  assert.equal(isDerivativeModel(null), false);
});

// ⚠ 著者名で判定しない。本物の研究組織も量子化版を出すし、再配布者も独自モデルを出す。
test('著者名では判定しない（ISTA-DASLab の本体は派生ではない）', () => {
  assert.equal(isDerivativeModel('ISTA-DASLab/Llama-3.1-8B'), false);
  assert.equal(isDerivativeModel('unsloth/my-original-finetune'), false);
});

test('本体と量子化版が同じキーになる', () => {
  assert.equal(baseModelKey('Qwen/Qwen3.8-27B'), 'qwen3.8-27b');
  assert.equal(baseModelKey('unsloth/Qwen3.8-27B-GGUF'), 'qwen3.8-27b');
  assert.equal(baseModelKey('ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF'), 'qwen3.8-27b');
  assert.equal(baseModelKey('openbmb/MiniCPM5-2B-GGUF'), baseModelKey('openbmb/MiniCPM5-2B'));
});

test('別のモデルは別のキーのまま', () => {
  assert.notEqual(baseModelKey('Qwen/Qwen3.8-27B'), baseModelKey('Qwen/Qwen3.8-70B'));
  assert.notEqual(baseModelKey('deepseek-ai/DeepSeek-V4.1-Flash'), baseModelKey('deepseek-ai/DeepSeek-V4.1-Pro'));
});

test('実物で重複が畳まれ、本体が残る', () => {
  const out = dedupeByBaseModel(REAL, x => x);
  assert.equal(out.length, 5, '8件 → 5件');
  assert.ok(out.includes('Qwen/Qwen3.8-27B'), '本体が残る');
  assert.ok(!out.includes('unsloth/Qwen3.8-27B-GGUF'), '量子化版は落ちる');
  assert.ok(!out.includes('ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF'));
  assert.ok(out.includes('openbmb/MiniCPM5-2B'), '本体が残る');
  assert.ok(!out.includes('openbmb/MiniCPM5-2B-GGUF'));
});

// ⚠ ここが「派生だから捨てる」ではなく「本体があるなら重ねない」であることの担保。
test('派生しか無ければ派生を残す（収集ゲートで消さない）', () => {
  const only = ['unsloth/Qwen3.8-27B-GGUF', 'dealignai/GLM-5.3-CYBERSECURITY-FP8'];
  const out = dedupeByBaseModel(only, x => x);
  assert.deepEqual(out, only, '1件も落とさない');
});

test('本体が後から来ても本体が残る（trending順が逆でも）', () => {
  const out = dedupeByBaseModel(['unsloth/Qwen3.8-27B-GGUF', 'Qwen/Qwen3.8-27B'], x => x);
  assert.deepEqual(out, ['Qwen/Qwen3.8-27B']);
});

test('入力の順序を壊さない', () => {
  const out = dedupeByBaseModel(REAL, x => x);
  assert.deepEqual(out, REAL.filter(x => out.includes(x)), '元の並びのまま');
});

test('空・不正な入力で落ちない', () => {
  assert.deepEqual(dedupeByBaseModel([], (x: string) => x), []);
  assert.equal(baseModelKey(''), '');
  assert.equal(baseModelKey(undefined), '');
});
