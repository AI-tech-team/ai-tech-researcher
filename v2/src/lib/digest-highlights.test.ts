import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHighlights, extractHighlightSection } from './digest-highlights';

// 本番 2026-09-10 配信分の抜粋（形はそのまま）。
const REAL = `AIエンジニア・研究者の皆様へ

2026年9月10日のAI技術動向デイリーレポートをお届けします。

---

## 🔥 今日のハイライト

### 1. 🤝 AWSとQualcomm、AIハードウェアで600億ドルの提携契約を締結
*   **何が起きたか**: QualcommがAWSと、AI推論用のカスタムシリコンを対象とした提携を発表しました。
*   **なぜ重要か**: AIハードウェア市場における戦略的提携として過去最大級です。
*   **実務への影響**: 推論特化型ハードウェアの進化を考慮した最適化が求められます。

### 2. 🚨 Anthropic研究者がAIの破局リスクを警告し退職
*   **何が起きたか**: 研究者が退職し、幹部も10%超の確率に同意しました。
*   **なぜ重要か**: 開発企業の内部から存在リスクへの懸念が公に表明されました。
*   **実務への影響**: アライメント研究やリスク評価手法の導入が不可欠となります。

---

## 🚀 急上昇トレンド

ハードウェアとエージェントが顕著な上昇を示しています。

## 📊 カテゴリ別トピック

### 研究/論文
*   **AIの安全保障リスクへの警告**: 議論が深まっています。
`;

test('ハイライトを見出しと3項目に分解できる', () => {
  const hi = parseHighlights(REAL);
  assert.equal(hi.length, 2);
  assert.equal(hi[0].points.length, 3);
  assert.deepEqual(hi[0].points.map(p => p.label), ['何が起きたか', 'なぜ重要か', '実務への影響']);
  assert.match(hi[0].points[0].text, /^QualcommがAWSと/);
});

test('見出しから連番と装飾の絵文字を落とす', () => {
  const hi = parseHighlights(REAL);
  assert.equal(hi[0].title, 'AWSとQualcomm、AIハードウェアで600億ドルの提携契約を締結');
  assert.equal(hi[1].title, 'Anthropic研究者がAIの破局リスクを警告し退職');
});

test('ハイライト以外のセクションを拾わない', () => {
  const hi = parseHighlights(REAL);
  // 「カテゴリ別トピック」の ### 研究/論文 を6本目として拾ってはいけない
  assert.equal(hi.length, 2);
  assert.ok(!hi.some(h => h.title === '研究/論文'));
});

test('ハイライトのセクションだけを切り出す', () => {
  const s = extractHighlightSection(REAL);
  assert.ok(s);
  assert.ok(s.includes('AWSとQualcomm'));
  assert.ok(!s.includes('急上昇トレンド'), 'ここで切れていないと読了時間が過大になる');
});

test('コロンが太字の内側にある古い形も取れる（バックナンバーが空にならない）', () => {
  // 2026-09-10 のプロンプト改訂より前の全レポートはこの形。落とすと過去の号が見出しだけになる。
  const md = `## 🔥 今日のハイライト

### 1. 🚀 Google NotebookLMがGemini 3.5で研究を自動化
*   **何が起きたか:** GoogleがNotebookLMを刷新しました。
*   **なぜ重要か:** 研究開発プロセスが効率化します。
`;
  const hi = parseHighlights(md);
  assert.deepEqual(hi[0].points.map(p => p.label), ['何が起きたか', 'なぜ重要か']);
  assert.match(hi[0].points[0].text, /^GoogleがNotebookLM/);
});

test('ラベルの無い箇条書きも本文として残す（欠落させない）', () => {
  const md = `## 🔥 今日のハイライト

### 1. 見出し
*   ラベルの無い一文です。
*   **Show-Harness**はVLMだけでロボットを操作できます。
`;
  const hi = parseHighlights(md);
  assert.equal(hi[0].points.length, 2);
  assert.deepEqual(hi[0].points.map(p => p.label), ['', '']);
  // 文中の強調をラベルと誤認しない（コロンが無いので本文のまま）
  assert.match(hi[0].points[1].text, /^Show-HarnessはVLMだけで/);
});

test('ラベル名を決め打ちしない（生成側の文言が変わっても取れる）', () => {
  const md = `## 🔥 今日のハイライト

### 1. 見出し
*   **要旨**: これは要旨です。
*   **背景**: これは背景です。
`;
  const hi = parseHighlights(md);
  assert.deepEqual(hi[0].points.map(p => p.label), ['要旨', '背景']);
});

test('箇条書きの記号と全角コロンの揺れを吸収する', () => {
  const md = `## 🔥 今日のハイライト

### 1. 見出し
- **何が起きたか**：全角コロンとハイフン。
+ **なぜ重要か**: プラス記号。
`;
  const hi = parseHighlights(md);
  assert.equal(hi[0].points.length, 2);
  assert.equal(hi[0].points[0].text, '全角コロンとハイフン。');
});

test('見出しだけで箇条書きが無くても項目として残す', () => {
  const hi = parseHighlights('## 🔥 今日のハイライト\n\n### 1. 見出しのみ\n');
  assert.equal(hi.length, 1);
  assert.deepEqual(hi[0].points, []);
});

test('ハイライトが無い・空入力なら空配列（落ちない）', () => {
  assert.deepEqual(parseHighlights(''), []);
  assert.deepEqual(parseHighlights('## 🚀 急上昇トレンド\n本文'), []);
  assert.equal(extractHighlightSection(''), null);
});
