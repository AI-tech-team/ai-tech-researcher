import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDigest, digestReadingSeconds, formatIssueDate } from './digest';
import { formatReadingTime } from './reading-time';

// 本番 2026-09-11 配信分（id=316）の抜粋。形はそのまま。
const REAL = `AIエンジニア・研究者の皆様へ

2026年9月11日のAI技術動向デイリーレポートをお届けします。本日は、OpenAIの強力な新モデル発表に焦点を当てます。

---

## 🔥 今日のハイライト

### 1. OpenAI、ビジネス向け次世代AIモデル「GPT-6 Astra」を発表
*   **何が起きたか**: OpenAIがビジネス用途に特化した次世代AIモデルを公開しました。
*   **なぜ重要か**: これはOpenAIの最新かつ最も強力なモデルです。
*   **実務への影響**: 企業は業務効率化や意思決定支援の革新を検討すべきです。

### 2. TSMC、AIチップ需要が牽引し2026年8月の収益が53.3%増加
*   **何が起きたか**: TSMCは、8月の収益が前年同月比で53.3%増加したと報告しました。
*   **なぜ重要か**: AIチップ市場の爆発的な成長を明確に示しています。
*   **実務への影響**: サプライチェーンと需要動向を注視すべきです。

---

## 🚀 急上昇トレンド

今週はAIハードウェアとエージェント技術の進展が顕著です。TSMCの記録的な収益増はAIチップ需要の成長を示します。

---

## 📊 カテゴリ別トピック

### ハードウェア
*   AI半導体装置ブームが台湾のIPC市場を再編しています。
*   中国のAIチップメーカーEnflameが上海証券取引所に上場しました。

### エージェント
*   「Show-Harness」は、VLMだけでロボットを操作できる新しいフレームワークです。

---

## 💡 エンジニアへの実践的インサイト

*   最新のAIモデルの能力を深く理解し、活用できるか常に検討してください。
*   エージェント開発者は、新しいフレームワークを積極的に試しましょう。
`;

test('前書きから宛名の挨拶行を落とす', () => {
  const d = parseDigest(REAL);
  assert.equal(d.lead.length, 1);
  assert.match(d.lead[0], /^2026年9月11日の/);
  assert.ok(!d.lead.some(l => l.includes('皆様')));
});

test('ハイライトは highlights に入り、sections には重複して出ない', () => {
  const d = parseDigest(REAL);
  assert.equal(d.highlights.length, 2);
  assert.equal(d.highlights[0].points.length, 3);
  assert.ok(!d.sections.some(s => s.title.includes('ハイライト')));
});

test('ハイライト以外のセクションを出現順に持つ', () => {
  const d = parseDigest(REAL);
  assert.deepEqual(d.sections.map(s => s.title),
    ['急上昇トレンド', 'カテゴリ別トピック', 'エンジニアへの実践的インサイト']);
  assert.deepEqual(d.sections.map(s => s.mark), ['🚀', '📊', '💡']);
});

test('段落・箇条書き・小見出しを塊に分ける', () => {
  const [trend, category, insight] = parseDigest(REAL).sections;

  assert.equal(trend.blocks.length, 1);
  assert.equal(trend.blocks[0].kind, 'p');

  // カテゴリ別は ### ごとに group
  assert.deepEqual(category.blocks.map(b => b.kind), ['group', 'group']);
  const hw = category.blocks[0];
  assert.ok(hw.kind === 'group');
  assert.equal(hw.title, 'ハードウェア');
  assert.equal(hw.items.length, 2);

  assert.deepEqual(insight.blocks.map(b => b.kind), ['list']);
  const list = insight.blocks[0];
  assert.ok(list.kind === 'list');
  assert.equal(list.items.length, 2);
});

test('強調記号は落として本文だけにする', () => {
  const d = parseDigest(REAL);
  const all = JSON.stringify(d);
  assert.ok(!all.includes('**'));
});

test('区切り線は紙面に出さない', () => {
  const d = parseDigest(REAL);
  const texts = d.sections.flatMap(s => s.blocks.flatMap(b => b.kind === 'p' ? [b.text] : b.items));
  assert.ok(!texts.some(t => /^-{3,}$/.test(t)));
});

test('週次のようにハイライトが無い形でも、セクションとして開ける', () => {
  const weekly = `## 今週のまとめ

OpenAIが次世代モデルを公開しました。

## 数字で見る一週間

*   収集記事 1,204本
`;
  const d = parseDigest(weekly);
  assert.equal(d.highlights.length, 0);
  assert.deepEqual(d.sections.map(s => s.title), ['今週のまとめ', '数字で見る一週間']);
});

test('空・壊れた入力でも落ちない', () => {
  assert.deepEqual(parseDigest(''), { lead: [], highlights: [], sections: [] });
  const broken = parseDigest('## \n\n---\n');
  assert.equal(broken.sections.length, 0);
});

test('本文に混じる内部IDの参照を落とす（古いレポート対策）', () => {
  const md = `## 📊 カテゴリ別トピック

### エージェント
*   エージェント技術の進化が加速しています（ID:4201, 4040）。
*   Hugging Face Spacesの事例です（ID:4038）。
*   別の形の参照 [ID:4189] も落とす。
`;
  const [sec] = parseDigest(md).sections;
  const g = sec.blocks[0];
  assert.ok(g.kind === 'group');
  assert.equal(g.items[0], 'エージェント技術の進化が加速しています。');
  assert.equal(g.items[1], 'Hugging Face Spacesの事例です。');
  assert.equal(g.items[2], '別の形の参照 も落とす。');
});

test('号の日付は曜日付きで、実行環境のタイムゾーンに依存しない', () => {
  // 2026-09-11 は金曜日。JST(手元)でもUTC(Vercel)でも同じ結果でなければならない。
  assert.equal(formatIssueDate('2026-09-11'), '2026年9月11日（金）');
  assert.equal(formatIssueDate('2026-09-11 06:00:00'), '2026年9月11日（金）');
  assert.equal(formatIssueDate('2026-01-01'), '2026年1月1日（木）');
  assert.equal(formatIssueDate(null), '');
  assert.equal(formatIssueDate('not-a-date'), '');
  assert.equal(formatIssueDate('2026-13-01'), '');
});

test('読了時間は 600字/分（表示側と同じ測り方）', () => {
  const sec = digestReadingSeconds(REAL);
  assert.ok(sec > 0);
  // 抜粋（約950字）なので2分未満に収まる
  assert.ok(sec < 120, `実測 ${formatReadingTime(sec)}`);
});
