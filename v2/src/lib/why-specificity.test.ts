import test from 'node:test';
import assert from 'node:assert/strict';
import { assessWhy, formatWhyReport, assessLabel, formatLabelReport, formatSpecificityReport } from './why-specificity';

// 2026-09-07 の本番の号（backups/backup_2026-09-06.json）から「なぜ重要か」5本を実物のまま。
// 作り物でなく実物で判定を固定する。
const REAL = `## 🔥 今日のハイライト

### 1. AI市場のControl Pointが「モデル」から「実行と統制」へ移動
*   **何が起きたか**: 分析されました。
*   **なぜ重要か**: この変化は、AI技術のビジネス適用において、単に優れたモデルを導入するだけでは不十分であり、企業全体のデータ戦略、ガバナンス、そして運用管理が競争の主軸となることを意味します。

### 2. OpenAIが10兆パラメータ超の次世代モデル「Bel」を完成か
*   **何が起きたか**: リーク情報が報じられました。
*   **なぜ重要か**: 前回のレポートでGPT-6 Astraの広範な能力が注目されましたが、「Bel」はそのさらに先を行く、スケールと目標において極めて野心的なプロジェクトです。

### 3. モデル乱立に「モデル疲労」と安全性の懸念
*   **何が起きたか**: 複数の新モデルが発表されました。
*   **なぜ重要か**: AI技術の進化の速さは目覚ましい一方で、その導入・運用側のキャパシティを超えるペースで新モデルが投入されることで、適切な評価や安全性の検証が追いつかなくなるリスクが顕在化しています。

### 4. AIエージェントの自律行動に備える賠償責任保険
*   **何が起きたか**: 保険が登場しました。
*   **なぜ重要か**: 2026年1月1日には、Insurance Services Office and Veriskが生成AIによる損害を一般賠償責任保険から除外する標準除外条項を導入しており、具体的な対策が求められています。

### 5. OpenAIが内部でコーディングエージェントを活用
*   **何が起きたか**: 明らかになりました。
*   **なぜ重要か**: これはAIエージェントが単なるエンドユーザー向けアプリケーションに留まらず、AIそのものの開発・研究サイクルを加速させる強力なメタツールとして機能し始めていることを示します。
`;

test('実物の号: 5本のうち具体は2本（1・3・5は一般論）', () => {
  const r = assessWhy(REAL);
  assert.equal(r.total, 5);
  assert.deepEqual(r.items.filter(x => x.concrete).map(x => x.index), [2, 4]);
  assert.equal(r.concrete, 2);
  assert.ok(r.items[1].signals.includes('GPT-6'), '固有名を根拠として拾う');
  assert.ok(r.items[3].signals.includes('数字'), '日付や金額は数字として拾う');
});

test('AI / LLM だけの文は「具体」と数えない（毎回出るので固有名の証拠にならない）', () => {
  const r = assessWhy(REAL);
  assert.equal(r.items[0].concrete, false, 'AIしか無い1本目は一般論');
  assert.equal(r.items[4].concrete, false, 'AIしか無い5本目は一般論');
});

test('中身を言わずに閉じる定型句を別に数える', () => {
  const r = assessWhy(REAL);
  assert.equal(r.items[3].hedged, true, '「求められています」を拾う');
  assert.ok(r.hedged >= 1);
});

test('ログ1行には判定と根拠だけを出す（文そのものは出さない）', () => {
  const line = formatWhyReport(assessWhy(REAL));
  assert.match(line, /なぜ重要か 5本: 具体2本/);
  assert.ok(!line.includes('企業全体のデータ戦略'), '本文を書き出さない');
});

test('「なぜ重要か」が無い形式でも落ちない', () => {
  assert.equal(assessWhy('## 🔥 今日のハイライト\n\n### 1. 題\n*   **何が起きたか**: 本文\n').total, 0);
  assert.match(formatWhyReport(assessWhy('')), /検出できず/);
});

// ── 対照つきの2行出力（2026-09-14 追加）──────────────────────────────
// 「なぜ重要か」だけを見ると、下がった日に指示の問題か材料の問題か切り分けられない。
const SAMPLE = `## 🔥 今日のハイライト

### 1. OpenAIがGPT-5.2を公開
*   **何が起きたか**: OpenAIがGPT-5.2を公開した。コンテキストは1Mトークン。
*   **なぜ重要か**: 長文処理の前提が変わり、設計の見直しが必要になります。

### 2. 推論基盤の整備が進む
*   **何が起きたか**: Nvidiaなど各社が推論基盤の整備を進めている。
*   **なぜ重要か**: 今後の競争力にとって重要になります。
`;

test('本命と対照の2行を返す', () => {
  const out = formatSpecificityReport(SAMPLE);
  const lines = out.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /なぜ重要か 2本/);
  assert.match(lines[1], /何が起きたか（対照） 2本/);
});

test('対照は具体が多く、本命は一般論を拾う（切り分けができる）', () => {
  const why = assessLabel(SAMPLE, 'なぜ重要か');
  const what = assessLabel(SAMPLE, '何が起きたか');
  assert.equal(why.concrete, 0);   // 固有名も数字も無い
  // ⚠ 1本しか拾わない。HEDGE は「必要となり」を持つが「必要になり」を持っていない＝実在する穴。
  //   ただし**今は広げない**。案B（09-14投入）の効果を concrete で前後比較している最中で、
  //   物差しを途中で変えると比べられなくなる。concrete は HEDGE の影響を受けないので本命は無事。
  //   比較が済んだら「必要になり」を足し、hedged の基準線44.8%は取り直す → [[prove-it]]
  assert.equal(why.hedged, 1);     // 「重要になります」だけ拾う
  assert.equal(what.concrete, 2);  // GPT-5.2 / 1M
});

test('存在しないラベルは0本として扱う（落ちない）', () => {
  assert.equal(assessLabel(SAMPLE, '実務への影響').total, 0);
  assert.match(formatLabelReport('実務への影響', assessLabel(SAMPLE, '実務への影響')), /検出できず/);
});
