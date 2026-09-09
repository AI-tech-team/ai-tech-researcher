import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGenericEntity, looksLikeSentence, isPublishableEntity, classifyEntityType } from './entity-quality';

// ケースは 2026-09-09 / 09-10 の本番実測（entities 1,620件）から取っている。
// 「落ちてほしいもの」と「絶対に落ちてはいけないもの」を対で書き、フィルタの誤爆を検知する。

test('isGenericEntity: 一般名詞・地名・役職は一般名詞と判定', () => {
  for (const n of ['AI', 'ai', 'LLMs', 'China', 'US', 'EU', 'CEO', 'CLI', 'AI agents', 'GPU']) {
    assert.equal(isGenericEntity(n), true, `${n} は一般名詞であるべき`);
  }
});

test('isGenericEntity: 固有名詞・追跡対象になる概念は落とさない', () => {
  for (const n of ['OpenAI', 'Anthropic', 'Nvidia', 'TSMC', 'Claude Code', 'Generative AI', 'GPT-5']) {
    assert.equal(isGenericEntity(n), false, `${n} を一般名詞にしてはいけない`);
  }
});

test('looksLikeSentence: 文・長すぎ・文字化けを検出', () => {
  assert.equal(looksLikeSentence('既存のLLMスケーリング則'), true);          // 実測 m=17 で11位に入っていた
  assert.equal(looksLikeSentence('TSMCのCoWoS先端パッケージング技術における供給能力の逼迫'), true);
  assert.equal(looksLikeSentence('a'.repeat(41)), true);
  assert.equal(looksLikeSentence('壊れた�文字'), true);
  assert.equal(looksLikeSentence(''), true);
});

test('looksLikeSentence: 助詞を含まない日本語の固有名は落とさない', () => {
  for (const n of ['ソフトバンク', '楽天', '富士通', '日立製作所', 'サイバーエージェント']) {
    assert.equal(looksLikeSentence(n), false, `${n} は固有名詞`);
  }
});

test('isPublishableEntity: mention_count のしきい値（実測で m=1 が81.5%）', () => {
  assert.equal(isPublishableEntity('Anthropic', 45), true);
  assert.equal(isPublishableEntity('8VC', 1), false);            // 一度きりの固有名詞
  assert.equal(isPublishableEntity('1010 Digital Works', 1), false);
  assert.equal(isPublishableEntity('AI', 42), false);            // 言及は多いが一般名詞
  assert.equal(isPublishableEntity('X', 99), false);             // 1文字は不可
});

test('classifyEntityType: 企業を model と誤分類しない（実測で全1,620件が model だった回帰）', () => {
  for (const n of ['OpenAI', 'Anthropic', 'Nvidia', 'TSMC', 'Mistral AI', 'Hugging Face', 'ASML', 'Cloudflare']) {
    assert.equal(classifyEntityType(n), 'company', `${n} は企業`);
  }
});

test('classifyEntityType: 法人格の接尾辞で企業と判定', () => {
  assert.equal(classifyEntityType('Modal Labs'), 'company');
  assert.equal(classifyEntityType('Empower Semiconductor'), 'company');
  assert.equal(classifyEntityType('Darfon Electronics Corp'), 'company');
  assert.equal(classifyEntityType('株式会社ほげ'), 'company');
});

test('classifyEntityType: モデル・製品・ベンチマーク', () => {
  assert.equal(classifyEntityType('GPT-5'), 'model');
  assert.equal(classifyEntityType('Claude Opus 4.8'), 'model');
  assert.equal(classifyEntityType('Llama 4'), 'model');
  assert.equal(classifyEntityType('Qwen3.8-Max'), 'model');
  assert.equal(classifyEntityType('Claude Code'), 'product');
  assert.equal(classifyEntityType('ChatGPT'), 'product');
  assert.equal(classifyEntityType('SWE-bench'), 'benchmark');
  assert.equal(classifyEntityType('Terminal-Bench 2.1'), 'benchmark');
  assert.equal(classifyEntityType('MMLU'), 'benchmark');
});

test('classifyEntityType: 実測で unknown に落ちていた言及上位を拾えるか', () => {
  assert.equal(classifyEntityType('GPT‑5.6 Sol'), 'model');        // U+2011 の非ASCIIハイフン
  assert.equal(classifyEntityType('Anthropic Claude'), 'model');   // ベンダー名が前置
  assert.equal(classifyEntityType('Opus 4.8'), 'model');
  assert.equal(classifyEntityType('Fable 5'), 'model');
  assert.equal(classifyEntityType('GLM-5.2'), 'model');
  assert.equal(classifyEntityType('Google Cloud'), 'product');
  assert.equal(classifyEntityType('Microsoft 365 Copilot'), 'product');
});

test('classifyEntityType: 技術名を企業と誤判定しない', () => {
  // ドライランで `technology` 接尾辞により company と誤判定されていた
  assert.equal(classifyEntityType("TSMC's CoWoS advanced packaging technology"), 'unknown');
});

test('classifyEntityType: 判別できないものは unknown（model と断定しない）', () => {
  assert.equal(classifyEntityType('io Products'), 'unknown');
  assert.equal(classifyEntityType('Jensen Huang'), 'unknown');
  assert.equal(classifyEntityType(''), 'unknown');
});
