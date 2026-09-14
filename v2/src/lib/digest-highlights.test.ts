import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHighlights, extractHighlightSection, buildRehashGuard, cleanText } from './digest-highlights';

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

// 2026-09-13 から出る形。「実務への影響」を廃し、代わりに **出典** を置いた。
// 出典行はこの日に足したばかりで、サイト表示もメールもこのパーサを通る＝壊れると全面に出る。
const NEW_FORMAT = `## 🔥 今日のハイライト

### 3. マルチモーダルモデルサービングを高速化するEncode-Prefill-Decode分離技術
*   **何が起きたか**: NVIDIAがEPD分離技術について解説しました。ビジョンエンコーダとプリフィル/デコード処理を分離することで推論効率の向上が期待されます。
*   **なぜ重要か**: 大規模マルチモーダルAIの実用化に向けた具体的な技術的アプローチを示しています。
*   **出典**: NVIDIA Developer Blog [一次情報]

### 5. Universal MusicとElevenLabsがAI音楽プラットフォームを共同ローンチ
*   **何が起きたか**: Universal Music GroupがElevenLabsと提携しました。
*   **なぜ重要か**: 音楽業界におけるAIの商業利用が本格化しています。
*   **出典**: The Verge [報道]
`;

test('新形式（出典行つき・何が起きたかが2文）を落とさない', () => {
  const hi = parseHighlights(NEW_FORMAT);
  assert.equal(hi.length, 2);
  assert.deepEqual(hi[0].points.map(p => p.label), ['何が起きたか', 'なぜ重要か', '出典']);
  assert.match(hi[0].points[0].text, /ビジョンエンコーダ/, '2文目が残る');
  assert.equal(hi[0].points[2].text, 'NVIDIA Developer Blog [一次情報]');
  assert.equal(hi[1].points[2].text, 'The Verge [報道]');
});

// 出典が読者に見える形で残ることが、「見解と一次情報を混ぜない」の担保になっている。
test('出典の [一次情報] / [報道] の別が本文として取り出せる', () => {
  const hi = parseHighlights(NEW_FORMAT);
  const tiers = hi.map(h => h.points.find(p => p.label === '出典')?.text ?? '');
  assert.equal(tiers.filter(t => t.includes('[一次情報]')).length, 1);
  assert.equal(tiers.filter(t => t.includes('[報道]')).length, 1);
});

// buildRehashGuard: 既報の焼き直し禁止に渡す材料
// 旧実装は本文の先頭1,200字を渡していたため、5本目の見出しが上限の外に落ちていた。
// 実際に 09-12 の5本目が消え、翌09-13 に1本目として返り咲いている（実測）。
const ed = (date: string, titles: string[]) => ({
  reportDate: date,
  content: '## 🔥 今日のハイライト\n\n' + titles.map((t, i) => `### ${i + 1}. ${t}\n- **何が起きたか**: ${'あ'.repeat(300)}\n`).join('\n'),
});

test('焼き直し防止: 本文が長くても、見出しは1本も落とさない', () => {
  const titles = ['A社が新モデル', 'B社が買収', 'C社が値下げ', 'D社が提携', 'E社が撤退'];
  const out = buildRehashGuard([ed('2026-09-12', titles)]);
  for (const t of titles) assert.ok(out.includes(t), `${t} が渡っていない`);
});

test('焼き直し防止: 複数号ぶん渡す（前号だけでは間の空いた再掲を捕まえられない）', () => {
  const out = buildRehashGuard([
    ed('2026-09-13', ['最新の話']),
    ed('2026-09-12', ['3日前の話']),
    ed('2026-09-09', ['5日前の話']),
  ]);
  assert.ok(out.includes('最新の話') && out.includes('3日前の話') && out.includes('5日前の話'));
});

test('焼き直し防止: 字数上限では古い号を丸ごと落とす（新しい号は途中で切らない）', () => {
  const many = Array.from({ length: 5 }, (_, i) => `見出し${i}が${'長'.repeat(40)}`);
  // 上限100字に対し新しい号だけで約250字。それでも新しい号は丸ごと残り、古い号は落ちるのが仕様。
  const out = buildRehashGuard([ed('2026-09-13', many), ed('2026-09-12', ['古い号の話'])], 100);
  for (const t of many) assert.ok(out.includes(t), `新しい号の ${t} が落ちている`);
  assert.ok(!out.includes('古い号の話'), '上限を超えているのに古い号が残っている');
});

test('焼き直し防止: ハイライトが取れない号は飛ばし、全部取れなければ空文字', () => {
  assert.equal(buildRehashGuard([{ reportDate: '2026-09-13', content: '見出しの無い本文' }]), '');
  assert.equal(buildRehashGuard([{ reportDate: null, content: null }]), '');
  assert.equal(buildRehashGuard([]), '');
});

// 紙面（トップの朝刊・/about）は装飾を持たないので、記号は落として中身だけ残す。
// 実測: バッククォートは公開142号のうち13号・56本（最後は2026-09-04）、リンクは1号・10本。
test('紙面のテキストに記号を残さない（コード・リンク・太字）', () => {
  assert.equal(cleanText('PyTorch 2.5の`torch.compile`を活用'), 'PyTorch 2.5のtorch.compileを活用');
  assert.equal(cleanText('参考: [PyTorch 2.5 Release Blog](https://pytorch.org/blog/x/)'), '参考: PyTorch 2.5 Release Blog');
  assert.equal(cleanText('**新登場**: 本文'), '新登場: 本文');
  for (const src of ['`a`', '[b](https://x.test/y)', '**c**']) {
    assert.ok(!/[`*]|\]\(/.test(cleanText(src)), `記号が残っている: ${src} -> ${cleanText(src)}`);
  }
});

test('紙面の整形は内部IDの除去を壊さない', () => {
  assert.equal(cleanText('本文（ID: 123）'), '本文');
  assert.equal(cleanText('本文 [ID:456]'), '本文');
});

// 2026-05-28〜2026-07-07 の33号は、各ハイライトを `### ` ではなく行頭の箇条書きで出していた。
// `### ` でしか割っていなかったため 0本になり、トップも過去号ページも紙面の組みを失っていた。
// 🔥 の構造ゲートは本数と文数しか見ず見出しレベルを強制しないので、生成側が戻れば再発する。
const OLD_LAYOUT = `## 🔥 今日のハイライト

*   **Anthropic、推論コスト削減へSamsungとチップ開発計画か** 💡
    *   **何が起きたか**: Anthropicがチップ開発に乗り出す可能性が浮上しました。
    *   **なぜ重要か**: 運用コストは大きな課題です。
    *   **実務への影響**: 選択肢が増える可能性があります。

*   **Nvidia、次世代AIラックが1年遅延** ⚙️
    *   **何が起きたか**: 製造問題により遅延しました。
    *   **なぜ重要か**: 競合に機会が生まれます。

## 🚀 急上昇トレンド
本文。`;

test('`###` で割れない旧レイアウトも箇条書きとして読む', () => {
  const hs = parseHighlights(OLD_LAYOUT);
  assert.equal(hs.length, 2);
  assert.equal(hs[0].title, 'Anthropic、推論コスト削減へSamsungとチップ開発計画か 💡');
  assert.equal(hs[0].points.length, 3);
  assert.deepEqual(hs[0].points[0], { label: '何が起きたか', text: 'Anthropicがチップ開発に乗り出す可能性が浮上しました。' });
  assert.equal(hs[1].points.length, 2);
  // 次のセクション(## 🚀)の本文を吸い込まない
  assert.ok(!JSON.stringify(hs).includes('急上昇'), JSON.stringify(hs));
});

test('新レイアウト（### 見出し）は今までどおり', () => {
  const md = `## 🔥 今日のハイライト

### 1. 見出しA

*   **何が起きたか**: 本文A。
*   **なぜ重要か**: 理由A。
`;
  const hs = parseHighlights(md);
  assert.equal(hs.length, 1);
  assert.equal(hs[0].title, '見出しA');
  assert.equal(hs[0].points.length, 2);
});

test('🔥セクションが無ければ空（後方互換で拾いすぎない）', () => {
  assert.deepEqual(parseHighlights('## 📊 カテゴリ別\n\n*   **項目**\n'), []);
});
