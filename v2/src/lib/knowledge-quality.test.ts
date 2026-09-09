import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  looksLikeEntity, isValidRelation, orderRelation,
  isValidBenchmarkName, isValidBenchmarkUnit, canonicalBenchmarkName, normalizeBenchmarkScore,
  isValidClaim,
} from './knowledge-quality';

// ケースはすべて 2026-09-10 の本番実測（relations 851 / benchmarks 466 / claims 2,858）から取っている。

// ── relations ────────────────────────────────────────────────────────
test('isValidRelation: 一般名詞が端に来る関係は落とす', () => {
  assert.equal(isValidRelation('Block', 'acquires', 'Generative AI'), false); // 実測の誤り
  assert.equal(isValidRelation('OpenAI', 'acquires', 'マルタ'), false);        // マルタ=地名(一般名詞)
  assert.equal(isValidRelation('AI', 'competes_with', 'OpenAI'), false);
});

test('isValidRelation: 自社製品の買収など包含関係は落とす', () => {
  // 実測: `Cloudflare --acquired_by--> Cloudflare Turnstile`
  assert.equal(isValidRelation('Cloudflare', 'acquires', 'Cloudflare Turnstile'), false);
  assert.equal(isValidRelation('OpenAI', 'competes_with', 'OpenAI Codex'), false);
  // develops は包含でも正しいので通す
  assert.equal(isValidRelation('Anthropic', 'develops', 'Anthropic Claude'), true);
});

test('isValidRelation: 正当な関係は通す', () => {
  assert.equal(isValidRelation('OpenAI', 'acquires', 'Ona'), true);
  assert.equal(isValidRelation('TSMC', 'supplies', 'Nvidia'), true);
  assert.equal(isValidRelation('01 AI', 'develops', 'Yi-Large'), true);
  assert.equal(isValidRelation('OpenAI', 'competes_with', 'Anthropic'), true);
});

test('isValidRelation: 未知の関係タイプ（旧 acquired_by 含む）は拒否', () => {
  assert.equal(isValidRelation('OpenAI', 'acquired_by', 'Ona'), false);
  assert.equal(isValidRelation('OpenAI', 'sued_by', 'Elsevier'), false);
});

test('orderRelation: 対称関係は辞書順に揃えて重複エッジを防ぐ', () => {
  const a = orderRelation('OpenAI', 'competes_with', 'Anthropic');
  const b = orderRelation('Anthropic', 'competes_with', 'OpenAI');
  assert.deepEqual(a, b);
  // 非対称関係は向きを保つ
  assert.deepEqual(orderRelation('OpenAI', 'acquires', 'Ona'), { subject: 'OpenAI', object: 'Ona' });
});

test('looksLikeEntity: 文の断片を弾く', () => {
  assert.equal(looksLikeEntity('OpenAI'), true);
  assert.equal(looksLikeEntity('Claude Opus 4.8'), true);
  assert.equal(looksLikeEntity('generative models are improving fast now'), false);
  assert.equal(looksLikeEntity('A社、B社と提携'), false);
});

// ── benchmarks ───────────────────────────────────────────────────────
test('isValidBenchmarkName: 業績・作業量・運用指標はベンチマークでない', () => {
  for (const n of [
    '2026年売上高見通し（上方修正後）', '2026年粗利益率見通し', '年収',
    'Commits (Day 1)', 'Files (Day 1)', 'Lines of Code (Day 1)', 'ADRs (Total)',
    'tok/s', 'token usage', '推論速度', 'unknown', 'group-128-compatible models',
    'コーディング能力', 'GPUカーネル最適化', 'AIベンチマーク',
    'decode', 'source-to-result',
  ]) {
    assert.equal(isValidBenchmarkName(n), false, `${n} はベンチマーク名でない`);
  }
});

test('isValidBenchmarkName: 実在のベンチマークは落とさない', () => {
  for (const n of [
    'SWE-bench', 'ARC-AGI', 'MMLU', 'GPQA', 'Terminal-Bench 2.1', 'OSWorld-Verified',
    'LiveCodeBench', 'IFBench', 'CyberGym', 'ExploitGym', 'Stanford LegalBench',
    'Baba Is Bench intro', 'Agents\' Last Exam', 'CursorBench 3.2',
  ]) {
    assert.equal(isValidBenchmarkName(n), true, `${n} は正当なベンチマーク名`);
  }
});

test('isValidBenchmarkUnit: 倍率・作業量の単位は比較不能なので拒否', () => {
  assert.equal(isValidBenchmarkUnit('x'), false);        // 実測: `AIエンジニアリング 52 x`
  assert.equal(isValidBenchmarkUnit('times'), false);    // 実測: `Zapier AutomationBench 1.5 times`
  assert.equal(isValidBenchmarkUnit('commits'), false);
  assert.equal(isValidBenchmarkUnit('分'), false);
  assert.equal(isValidBenchmarkUnit('%'), true);
  assert.equal(isValidBenchmarkUnit('points'), true);
  assert.equal(isValidBenchmarkUnit(null), true);
});

test('canonicalBenchmarkName: 表記ゆれを1つに畳む', () => {
  assert.equal(canonicalBenchmarkName('exploit gym'), 'ExploitGym');
  assert.equal(canonicalBenchmarkName('ExploitGym'), 'ExploitGym');
  assert.equal(canonicalBenchmarkName('SWE bench'), 'SWE-bench');
  assert.equal(canonicalBenchmarkName('LMArena'), 'Chatbot Arena (Elo)');
  assert.equal(canonicalBenchmarkName('Stanford LegalBench'), 'LegalBench');
  assert.equal(canonicalBenchmarkName('Terminal-Bench 2.1'), 'Terminal-Bench');
});

test('normalizeBenchmarkScore: 0-1スケールを%に統一し異常値を弾く', () => {
  assert.equal(normalizeBenchmarkScore('SWE-bench', 0.872, null), 87.2);
  assert.equal(normalizeBenchmarkScore('SWE-bench', 80, '%'), 80);
  assert.equal(normalizeBenchmarkScore('SWE-bench', 180, '%'), null);
  // 実測: `Claude Opus 4.8 / Stanford LegalBench 0.823` が `10 %` と同じ表に並んでいた
  assert.equal(normalizeBenchmarkScore('LegalBench', 0.823, null), 82.3);
  // ちょうど 1 は「1位/1点/満点」の区別がつかない。旧実装は 100% に化けさせていた
  // （実測: `Cursor Composer 2.5 / SWE-bench = 1` → 100%）ので捨てる。
  assert.equal(normalizeBenchmarkScore('SWE-bench', 1, null), null);
  assert.equal(normalizeBenchmarkScore('ExploitGym', 1, null), null);
  // Elo は 0-100 化してはいけない
  assert.equal(normalizeBenchmarkScore('Chatbot Arena (Elo)', 1631, 'points'), 1631);
  assert.equal(normalizeBenchmarkScore('Chatbot Arena (Elo)', 87, 'points'), null);
  // 未知のベンチはスケール変換しない
  assert.equal(normalizeBenchmarkScore('PyMatching', 42, null), 42);
  assert.equal(normalizeBenchmarkScore('PyMatching', -1, null), null);
});

// ── claims ───────────────────────────────────────────────────────────
test('isValidClaim: 推測・伝聞は落とす（プロンプトで禁止しても通っていた）', () => {
  // 実測: `ChatGPT / ヤコビ予想の反例を持つ可能性を示唆 = true`
  assert.equal(isValidClaim('ChatGPT', 'ヤコビ予想の反例を持つ可能性を示唆', 'true'), false);
  assert.equal(isValidClaim('OpenAI', '次期モデル', '2027年に登場するだろう'), false);
  assert.equal(isValidClaim('Anthropic', '資金調達', 'リークによれば100億ドル'), false);
});

test('isValidClaim: predicate が文になっているものを落とす', () => {
  const p = '企業の業務フローにAIを組み込みやすい形で提供することで、開発・運用・分析などの領域で自動化を加速させることができる';
  assert.equal(isValidClaim('NVIDIA', p, '推論コストやデータ連携が鍵になる'), false);
});

test('isValidClaim: 値になっていない値を落とす', () => {
  assert.equal(isValidClaim('OpenAI', '売上', 'true'), false);
  assert.equal(isValidClaim('OpenAI', '売上', '不明'), false);
  assert.equal(isValidClaim('OpenAI', '売上', ''), false);
});

test('isValidClaim: 一般名詞が主語のものを落とす', () => {
  // 実測: `AI / LLMの進化 = LLMは進化しており…`
  assert.equal(isValidClaim('AI', 'LLMの進化', 'LLMは進化しており以前は不可能と考えられていたタスクを実行できる'), false);
});

test('isValidClaim: 正当なクレームは落とさない', () => {
  assert.equal(isValidClaim('Nvidia', '設備投資額', '1500億ドル'), true);
  assert.equal(isValidClaim('Anthropic', '年次収益実行率', '470億ドル'), true);
  assert.equal(isValidClaim('Nvidia', 'CEO', 'Jensen Huang'), true);
  assert.equal(isValidClaim('TSMC', 'CoWoS-L先端パッケージングの供給能力の予約状況', '2026年末まで完全に予約済み'), true);
});
