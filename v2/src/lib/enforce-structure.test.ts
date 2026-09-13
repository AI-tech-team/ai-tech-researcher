import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  firstSentences, enforceStructure, fitToBudget, dropSection, limitBullets, limitSentencesIn,
  countHighlights, checkBudget, readableLength,
} from './daily-report';

// 本番 2026-09-12 号の実物をそのまま縮めたもの。
// 違反の型はすべて実測で確認したもの: 各行が2文 / カテゴリが4つ / 1カテゴリに2項目 / インサイトが4項目。
const REAL = `## 🔥 今日のハイライト

### 1. OpenAIのサム・アルトマンCEO、AI開発速度を緩める可能性を示唆
*   **何が起きたか**: OpenAIのサム・アルトマンCEOが、AI開発のペースを落とす可能性について言及しました。AIの急速な進化に対する懸念が背景にあると見られます。3文目はここで落ちる。
*   **なぜ重要か**: これは業界のリーダーが、AIの安全性を重視し始めている兆候です。今後のAI開発戦略に大きな影響を与える可能性があります。
*   **実務への影響**: AI開発者は、社会への影響も考慮した開発が求められます。倫理的ガイドラインの策定にも注目すべきです。

### 2. OpenAI、Agents APIを全開発者に開放
*   **何が起きたか**: OpenAIが「Codex」の基盤技術を公開しました。これにより複数エージェント連携が容易になります。
*   **なぜ重要か**: 開発ハードルが大幅に下がります。普及が加速します。
*   **実務への影響**: 複雑な業務を自動化できます。組み合わせも有効です。

## 🚀 急上昇トレンド

エージェント技術への関心が急上昇しています。特にAPIの公開が話題です。ハードウェア分野でも動きがありました。金融向けの発表も相次ぎました。

## 📊 カテゴリ別トピック

### エージェント
*   OpenAIの「Agents API」公開により、開発者は連携可能なAIを容易に構築できるようになりました。実用的なエージェント開発が進むでしょう。
*   Agentic AIの制御問題に対し、新しい内部駆動原理が提案されました。高度なシステムの実現を目指します。

### ハードウェア
*   京セラは、シリコン光回路上への光アイソレータ直接集積技術に成功しました。世界初の技術です。
*   GPU-CFRは、GPU上での処理を80.4倍高速に実行できると主張しています。最適化によるものです。

### LLM推論
*   DeepSeekがV4.1 Flashモデルをリリースしました。低価格で提供しています。

### 研究/論文
*   Anthropicの研究者が新しい手法を発表しました。検証が進んでいます。

## 💡 エンジニアへの実践的インサイト
*   **Agents APIを試す**: PoC を開始しましょう。まずは小さく始めるのが良いです。
*   **AI倫理への意識を高める**: 議論に参加することが重要です。
*   **多様なLLMを評価する**: 積極的に検証しましょう。
*   **AIインフラの進化を追う**: 常に把握しましょう。
`;

test('firstSentences: 句点で切り、末尾の断片は落とす', () => {
  assert.equal(firstSentences('あ。い。う。'), 'あ。');
  assert.equal(firstSentences('あ。い。う。', 2), 'あ。い。');
  assert.equal(firstSentences('あ。い'), 'あ。');            // 句点の無い末尾は捨てる
  assert.equal(firstSentences('句点なし'), '句点なし');       // 1文も取れないならそのまま
  assert.equal(firstSentences(''), '');
});

// 2026-09-13: 🔥 は 1文 → 2文に緩めた（3分の器に1分50秒しか入っていなかった）。
// 守るべき線は「本数を触らない」ことと「3文目は落ちる」こと。
test('ハイライトは本数を変えず、各行を2文までにする', () => {
  const out = enforceStructure(REAL);
  assert.equal(countHighlights(out), countHighlights(REAL), 'ハイライトの本数は触らない');
  assert.match(out, /AIの急速な進化に対する懸念が背景にあると見られます。/, '2文目は残る');
  assert.doesNotMatch(out, /3文目はここで落ちる/, '3文目は落ちる');
  assert.match(out, /### 1\. /);
  assert.match(out, /### 2\. /);
});

// 緩めた分の受け皿。これが無いと 🔥 が膨らんだ号を誰も止められない（2026-09-10 の9分07秒の型）。
test('最後の手段としてハイライトを1文に戻せる（本数は変えない）', () => {
  const out = limitSentencesIn(REAL, '🔥', 1);
  assert.equal(countHighlights(out), countHighlights(REAL), '本数は変えない');
  assert.doesNotMatch(out, /AIの急速な進化に対する懸念/, '2文目が落ちる');
  assert.ok(readableLength(out) < readableLength(REAL), '短くなる');
});

test('limitSentencesIn は対象セクション以外に触らない', () => {
  const out = limitSentencesIn(REAL, '🔥', 1);
  assert.match(out, /京セラは、シリコン光回路上への光アイソレータ直接集積技術に成功しました。/, '📊 は無傷');
});

test('カテゴリは最大3つ、1カテゴリ1項目1文にする', () => {
  const out = enforceStructure(REAL);
  const cat = out.split(/^## /m).find(p => p.startsWith('📊')) ?? '';
  assert.equal((cat.match(/^### /gm) ?? []).length, 3, 'カテゴリは3つまで');
  assert.doesNotMatch(cat, /研究\/論文/, '4つ目のカテゴリは丸ごと落ちる');
  assert.equal((cat.match(/^\*   /gm) ?? []).length, 3, '1カテゴリ1項目');
  assert.doesNotMatch(cat, /Agentic AIの制御問題/, '2項目目は落ちる');
  assert.doesNotMatch(cat, /実用的なエージェント開発が進むでしょう/, '2文目は落ちる');
});

test('インサイトは3項目・各1文にする', () => {
  const out = enforceStructure(REAL);
  const ins = out.split(/^## /m).find(p => p.startsWith('💡')) ?? '';
  assert.equal((ins.match(/^\*   /gm) ?? []).length, 3);
  assert.doesNotMatch(ins, /AIインフラの進化を追う/, '4項目目は落ちる');
  assert.doesNotMatch(ins, /まずは小さく始めるのが良いです/, '2文目は落ちる');
  assert.match(ins, /\*\*Agents APIを試す\*\*: PoC を開始しましょう。/, 'ラベルは残す');
});

test('急上昇トレンドは2文にする', () => {
  const out = enforceStructure(REAL);
  const tr = out.split(/^## /m).find(p => p.startsWith('🚀')) ?? '';
  assert.match(tr, /エージェント技術への関心が急上昇しています。特にAPIの公開が話題です。/);
  assert.doesNotMatch(tr, /金融向けの発表/);
});

test('実物に掛けるとセクション別の超過が出ない', () => {
  assert.deepEqual(checkBudget(enforceStructure(REAL)), [], '強制後は全セクションが上限内');
});

// ── fitToBudget（3分に収まるまで価値の低い順に落とす）──

test('dropSection: 指定した印のセクションだけ丸ごと消す', () => {
  const out = dropSection(REAL, '📊');
  assert.doesNotMatch(out, /カテゴリ別トピック/);
  assert.doesNotMatch(out, /京セラ/, 'そのセクションの中身も消える');
  assert.match(out, /今日のハイライト/, '他のセクションは残る');
  assert.match(out, /エンジニアへの実践的インサイト/, '後続のセクションも残る');
});

test('limitBullets: 指定した印のセクションの項目数だけを切る', () => {
  const out = limitBullets(REAL, '💡', 2);
  const ins = out.split(/^## /m).find(p => p.startsWith('💡')) ?? '';
  assert.equal((ins.match(/^\*   /gm) ?? []).length, 2);
  const hi = out.split(/^## /m).find(p => p.startsWith('🔥')) ?? '';
  assert.equal((hi.match(/^\*   /gm) ?? []).length, 6, '他セクションの項目は触らない');
});

test('fitToBudget: 3分に収め、ハイライトの本数は変えない', () => {
  const { text, steps } = fitToBudget(REAL);
  assert.ok(readableLength(text) <= 1800, `${readableLength(text)}字 > 1800字`);
  assert.equal(countHighlights(text), countHighlights(REAL), 'ハイライト5本は商品の約束＝絶対に削らない');
  assert.ok(Array.isArray(steps));
});

test('fitToBudget: 最初に落とすのはカテゴリ別トピック（ハイライトの言い直しだから）', () => {
  // 本文を膨らませて、必ず1段は落とさざるを得ない状態にする
  const fat = REAL.replace(/^(\*   \*\*何が起きたか\*\*: )/gm, `$1${'あ'.repeat(900)}。`);
  const { text, steps } = fitToBudget(fat);
  assert.ok(steps.length > 0, '超過しているので何かは落ちる');
  assert.match(steps[0], /カテゴリ別トピック/);
  assert.doesNotMatch(text, /カテゴリ別トピック/);
});

test('fitToBudget: 収まっているものは削らない', () => {
  const small = '## 🔥 今日のハイライト\n\n### 1. あ\n*   **何が起きたか**: い。\n\n## 💡 エンジニアへの実践的インサイト\n*   **う**: え。\n';
  const { text, steps } = fitToBudget(small);
  assert.deepEqual(steps, [], '予算内なら1段も落とさない');
  assert.match(text, /エンジニアへの実践的インサイト/);
});

test('fitToBudget: 全部落としても超過するなら、短くする方をあきらめる（例外を投げない）', () => {
  const huge = '## 🔥 今日のハイライト\n\n'
    + [1, 2, 3, 4, 5].map(n => `### ${n}. 見出し\n*   **何が起きたか**: ${'あ'.repeat(900)}。\n`).join('\n');
  const { text } = fitToBudget(huge);
  assert.equal(countHighlights(text), 5, 'ハイライトは5本のまま残る');
  assert.ok(readableLength(text) > 1800, 'この入力は削り切れない（＝警告ログで気づく想定）');
});

test('壊れた入力でも例外を投げず、内容を増やさない', () => {
  for (const s of ['', '   ', 'ただの文章', '## 🔥 見出しだけ', '*   印だけ']) {
    const out = enforceStructure(s);
    assert.equal(typeof out, 'string');
    assert.ok(out.length <= s.length + 1, `増えていない: ${JSON.stringify(s)}`);
  }
});

test('セクション外の行はそのまま通す', () => {
  const src = '冒頭の前書き。これは残る。\n\n## 🔥 今日のハイライト\n\n### 1. あ\n*   **何が起きたか**: い。う。\n';
  const out = enforceStructure(src);
  assert.match(out, /冒頭の前書き。これは残る。/);
});
