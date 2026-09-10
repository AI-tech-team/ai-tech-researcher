// ケースは 2026-09-10 に本番DBで実際に混入していたタイトルから取っている。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeHtmlEntities as d } from './html-entities';

test('本番に実在した混入タイトルを直す', () => {
  assert.equal(d("The foldable iPhone Duo is Apple&#39;s boldest smartphone experiment"),
    "The foldable iPhone Duo is Apple's boldest smartphone experiment");
  assert.equal(d("Apple&#039;s iPhone 18 Pro adds variable camera aperture"),
    "Apple's iPhone 18 Pro adds variable camera aperture");
  assert.equal(d("Hands-on with Siri Modular, watchOS 27&#8217;s new Apple Watch face"),
    'Hands-on with Siri Modular, watchOS 27’s new Apple Watch face');
  assert.equal(d("Anthropic has a cute graphic showing how its AI spread &#39;malicious&#39; code"),
    "Anthropic has a cute graphic showing how its AI spread 'malicious' code");
});

test('固有名を割っていた &#45; を直す（接続語の抽出も直る）', () => {
  assert.equal(d('「Grok 4.6」が登場…GPT&#45;5.6 SolやClaude Fable 5と並ぶ'),
    '「Grok 4.6」が登場…GPT-5.6 SolやClaude Fable 5と並ぶ');
  assert.equal(d('AIモデル「Qwen3.8&#45;Max」の大口商用ユーザー'), 'AIモデル「Qwen3.8-Max」の大口商用ユーザー');
});

test('名前付き・16進を解く', () => {
  assert.equal(d('A &amp; B'), 'A & B');
  assert.equal(d('&lt;script&gt;'), '<script>');
  assert.equal(d('&quot;引用&quot;'), '"引用"');
  assert.equal(d('&#x2014;'), '—');
  assert.equal(d('caf&eacute;'), 'café');
});

test('二重エスケープを解く', () => {
  assert.equal(d('Nvidia&amp;#039;s $20 Billion Groq Deal'), "Nvidia's $20 Billion Groq Deal");
  assert.equal(d('&amp;amp;'), '&');
});

test('知らない名前・壊れた参照は原文のまま残す', () => {
  assert.equal(d('&unknownentity;'), '&unknownentity;');
  assert.equal(d('R&D と Q&A'), 'R&D と Q&A');
  assert.equal(d('&#999999999;'), '&#999999999;');
  assert.equal(d('&#0;'), '&#0;');
  assert.equal(d('&#xD800;'), '&#xD800;', 'サロゲートは実体化しない');
});

test('& を含まない文字列はそのまま返す', () => {
  const s = 'OpenAI、業務向けの「GPT-6 Astra」を投入';
  assert.equal(d(s), s);
  assert.equal(d(''), '');
});
