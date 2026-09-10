// link-terms のテスト。ケースは全て 2026-09-10 の本番実測で実際に起きた誤接続から取っている。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripInternalIdPrefix, extractAsciiPhrases, extractJaProperNouns,
  extractLinkTerms, isHubTerm, isUsableLinkTerm, baseFormOf, sharedLinkTerms, type PosToken,
} from './link-terms';

const N = 22712; // 実測時の本番コーパス件数

// --- 型C: 複合固有名詞を割らない ---
test('Read the Docs を割らない（read/the/docs → Google Docs への誤接続を防ぐ）', () => {
  assert.deepEqual(extractAsciiPhrases('Read the Docsに対するDDoS攻撃の理解'), ['Read the Docs', 'DDoS']);
});

test('Listen Labs を割らない（listen → Postgres LISTEN/NOTIFY への誤接続を防ぐ）', () => {
  const t = extractAsciiPhrases('Salesforce、AI研究スタートアップListen Labsを20億ドルで買収交渉中');
  assert.ok(t.includes('Listen Labs'), JSON.stringify(t));
  assert.ok(!t.includes('Listen'), 'Listen 単独が出てはいけない');
});

test('版番号は固有名に付けて句にする', () => {
  assert.ok(extractAsciiPhrases('OpenAI、ChatGPTの画像生成時間をImages 2.5で半減').includes('Images 2.5'));
  assert.ok(extractAsciiPhrases('「AirPods 5」登場　ノイキャン性能向上').includes('AirPods 5'));
  assert.ok(extractAsciiPhrases('GPT-6 Astra、ループ型トランスフォーマー、隠れた推論').includes('GPT-6 Astra'));
  assert.ok(extractAsciiPhrases('Qwen 3.8はGPT-5.5 Proの推論プリフィルを追随').includes('GPT-5.5 Pro'));
});

// --- 型B: 数値は接続語にしない ---
test('数値だけの語は落ちる（1300億トークン → AIカメラ1,300台 の誤接続を防ぐ）', () => {
  const t = extractLinkTerms('OpenAIのAIエージェントが90年前の数学の問題を解くのに1300億トークンを費やす');
  assert.ok(!t.includes('1300'), JSON.stringify(t));
  assert.ok(!t.includes('90'));
});

test('価格の数字は落ちる（3800 → 記事ID[3800] の誤接続を防ぐ）', () => {
  const t = extractLinkTerms('「AirPods 5」登場　ノイキャン性能向上、従来比でノイズを50％除去　2万3800円から');
  assert.ok(!t.some((x) => /^\d+$/.test(x)), JSON.stringify(t));
  assert.ok(t.includes('AirPods 5'));
});

// --- 型A: 一般語は品詞で落ちる ---
test('サ変接続・代名詞・一般名詞は接続語にならない', () => {
  const toks: PosToken[] = [
    { surface: 'Anthropic', pos: '名詞', d1: '固有名詞', d2: '組織' },
    { surface: '警告', pos: '名詞', d1: 'サ変接続' },
    { surface: '退職', pos: '名詞', d1: 'サ変接続' },
    { surface: '我々', pos: '名詞', d1: '代名詞', d2: '一般' },
    { surface: '全員', pos: '名詞', d1: '一般' },
  ];
  assert.deepEqual(extractJaProperNouns(toks), []); // Anthropic は ASCII 経路で取るのでここでは出ない
});

test('地域は接続語にならない（中国・日本）', () => {
  const toks: PosToken[] = [
    { surface: '中国', pos: '名詞', d1: '固有名詞', d2: '地域' },
    { surface: '日立', pos: '名詞', d1: '固有名詞', d2: '組織' },
  ];
  assert.deepEqual(extractJaProperNouns(toks), ['日立']);
});

// --- 内部ID混入 ---
test('タイトル先頭の内部IDを落とす', () => {
  assert.equal(stripInternalIdPrefix('[3800] 量子化アウェアトレーニングによる Gemma 4'),
    '量子化アウェアトレーニングによる Gemma 4');
  assert.ok(extractLinkTerms('[8962] Shopify、PyTorch Foundationのプラチナメンバーとして参加').includes('Shopify'));
  assert.equal(stripInternalIdPrefix('通常のタイトル [123] は残す'), '通常のタイトル [123] は残す');
});

// --- 一般概念語 ---
test('AI / LLM は接続語にならない', () => {
  const t = extractLinkTerms('AccentureとGoogleが提携、1000人のエンジニアを現場に派遣しAIでクライアントを支援');
  assert.ok(t.includes('Accenture'));
  assert.ok(!t.includes('AI'), JSON.stringify(t));
});

// --- 型D: ハブ判定 ---
test('ハブ語だけを落とし、固有の製品名は残す（実測ラベルどおり）', () => {
  for (const df of [85, 134, 294, 396]) assert.equal(isHubTerm(df, N), false, `df=${df} は接続語`);
  for (const df of [727, 1152, 1292, 1388]) assert.equal(isHubTerm(df, N), true, `df=${df} はハブ`);
});

// --- 版番号を落とした形（索引が句を引けない問題への対処） ---
test('末尾の版番号を落とした形も候補にする', () => {
  assert.equal(baseFormOf('AirPods 5'), 'AirPods');
  assert.equal(baseFormOf('Images 2.5'), 'Images');
  assert.equal(baseFormOf('Nx Plugin for AWS 1.0'), 'Nx Plugin for AWS');
  assert.equal(baseFormOf('GPT-5.5 Pro'), 'GPT-5.5 Pro', '末尾が数字でなければ変えない');
  const t = extractLinkTerms('OpenAI、ChatGPTの画像生成時間をImages 2.5で半減');
  assert.ok(t.includes('Images 2.5') && t.includes('Images'), JSON.stringify(t));
});

test('頭の語だけを取り出すことはしない（Listen Labs → Listen の再発防止）', () => {
  assert.equal(baseFormOf('Listen Labs'), 'Listen Labs');
  const t = extractLinkTerms('Salesforce、AI研究スタートアップListen Labsを20億ドルで買収交渉中');
  assert.ok(!t.includes('Listen'), JSON.stringify(t));
});

// --- 規則②: 重複判定 ---
test('Siri AI と Siri は同じものとして重複判定される', () => {
  assert.deepEqual(sharedLinkTerms(['Siri AI'], ['Siri']), ['Siri']);
  assert.deepEqual(sharedLinkTerms(['AirPods 5', 'AirPods'], ['AirPods']), ['AirPods']);
});

test('短い一致では重複にしない（誤merge＝サイレントな欠落を避ける）', () => {
  assert.deepEqual(sharedLinkTerms(['Nx Plugin'], ['Nx']), []);
  assert.deepEqual(sharedLinkTerms(['Shopify'], ['Salesforce']), []);
});

test('自分の記事にしか無い語は接続に使えない', () => {
  assert.equal(isUsableLinkTerm('Besxar', 1, N), false);
  assert.equal(isUsableLinkTerm('Accenture', 6, N), true);
  assert.equal(isUsableLinkTerm('OpenAI', 1388, N), false);
});
