import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTopWithDomainCap, readableLength, checkBudget, SECTION_BUDGET, countHighlights, REQUIRED_HIGHLIGHTS } from './daily-report';

const u = (host: string, n: number) => ({ url: `https://${host}/a${n}` });

test('1ドメインは上限まで', () => {
  const rows = [...Array(10)].map((_, i) => u('apple.example', i));
  const got = pickTopWithDomainCap(rows, 40, 5);
  assert.equal(got.length, 10, '枠が余るので上限超過分も補充される');
  assert.deepEqual(got.slice(0, 5), rows.slice(0, 5), '先に上限分が入る');
});

test('上限を超えた分は後回しになり、他ドメインが先に入る', () => {
  const rows = [...[...Array(8)].map((_, i) => u('apple.example', i)), u('other.example', 0)];
  const got = pickTopWithDomainCap(rows, 6, 5);
  assert.equal(got.length, 6);
  assert.equal(got[5].url, 'https://other.example/a0', '6番目は Apple ではなく別ドメイン');
});

test('www は同一ドメインとして数える', () => {
  const rows = [
    { url: 'https://www.apple.example/1' }, { url: 'https://apple.example/2' },
    { url: 'https://www.apple.example/3' }, { url: 'https://other.example/1' },
  ];
  const got = pickTopWithDomainCap(rows, 4, 2);
  assert.deepEqual(got.map(r => r.url), [
    'https://www.apple.example/1', 'https://apple.example/2',
    'https://other.example/1', 'https://www.apple.example/3',
  ]);
});

test('limit で打ち切る', () => {
  const rows = [...Array(50)].map((_, i) => u(`d${i}.example`, i));
  assert.equal(pickTopWithDomainCap(rows, 40, 5).length, 40);
});

test('URLが無い・壊れている行も落とさない', () => {
  const rows = [{ url: null }, { url: 'not a url' }, u('a.example', 1)];
  assert.equal(pickTopWithDomainCap(rows, 40, 5).length, 3, '欠落より冗長を選ぶ');
});

test('入力が空なら空', () => {
  assert.deepEqual(pickTopWithDomainCap([], 40, 5), []);
});

// ── 字数の上限（読者との「3分／5分／7分」の約束を守るための判定）──
// 上限をプロンプトに書くだけでは守られなかった（実測: 指示1500〜2000字に対し4,269〜5,655字）ので、
// 生成後にこの関数で測って書き直させる。判定が壊れると約束が静かに破れるので固定する。

/** テスト用に「## 🔥 見出し + 本文」のセクションを1つ作る。 */
const section = (mark: string, body: string) => `## ${mark} 見出し\n${body}\n`;

test('readableLength はMarkdown記号を数えない', () => {
  assert.equal(readableLength('## **見出し**'), 3);
  assert.equal(readableLength('*   項目'), 2);
  assert.equal(readableLength('   '), 0);
});

test('readableLength は連続する空白・改行を1つに畳む', () => {
  assert.equal(readableLength('あ\n\nい'), 3, '改行1つぶんが空白として残る');
  assert.equal(readableLength('あ   い'), 3);
});

test('全セクションが上限内なら空配列', () => {
  const text = SECTION_BUDGET.map(s => section(s.mark, 'あ'.repeat(s.max - 20))).join('\n');
  assert.deepEqual(checkBudget(text), []);
});

test('超過したセクションだけを実測値つきで返す', () => {
  const hi = SECTION_BUDGET[0];
  const text = [
    section(hi.mark, 'あ'.repeat(hi.max + 200)),
    section(SECTION_BUDGET[1].mark, 'い'.repeat(50)),
  ].join('\n');
  const over = checkBudget(text);
  assert.equal(over.length, 1, 'ハイライトだけが超過');
  assert.equal(over[0].name, hi.name);
  assert.equal(over[0].max, hi.max);
  assert.ok(over[0].len > hi.max, `実測 ${over[0].len} > 上限 ${hi.max}`);
});

test('複数セクションが超過したら全部返す', () => {
  const text = SECTION_BUDGET.map(s => section(s.mark, 'あ'.repeat(s.max + 100))).join('\n');
  assert.equal(checkBudget(text).length, SECTION_BUDGET.length);
});

test('ちょうど上限は許し、1文字超えたら弾く（境界）', () => {
  const hi = SECTION_BUDGET[0];
  // 見出しや改行の畳まれ方を計算で当てるとずれるので、実際に測って上限ちょうどまで詰める
  let body = 'あ'.repeat(hi.max);
  while (readableLength(section(hi.mark, body)) > hi.max) body = body.slice(0, -1);

  const exact = section(hi.mark, body);
  assert.equal(readableLength(exact), hi.max);
  assert.deepEqual(checkBudget(exact), [], '上限ちょうどは許す');

  const oneOver = checkBudget(section(hi.mark, body + 'あ'));
  assert.equal(oneOver.length, 1, '1文字超えたら弾く');
  assert.equal(oneOver[0].len, hi.max + 1);
});

test('セクションが欠けていても落ちない', () => {
  assert.deepEqual(checkBudget(''), []);
  assert.deepEqual(checkBudget('前書きだけで見出しが無い本文'), []);
});

// 約束は「1号を読み終わるまで3分」。2026-09-12にセクション積み上げを引き直した
// （旧: ハイライトまで3分／全文7分 ＝ 号全体は4分53秒あった）。
test('全セクションの合計が3分ぶん＝号1本の約束', () => {
  const total = SECTION_BUDGET.reduce((n, s) => n + s.max, 0);
  assert.equal(total, 3 * 600, 'ここがずれると「3分で読み終わる」の約束が変わる');
});

test('ハイライトが号の大半を占める（残りは添え物）', () => {
  const hi = SECTION_BUDGET.find(s => s.name === '今日のハイライト');
  assert.ok(hi);
  const rest = SECTION_BUDGET.filter(s => s.name !== '今日のハイライト').reduce((n, s) => n + s.max, 0);
  assert.ok(hi.max > rest, `ハイライト${hi.max}字 ≦ その他${rest}字 では主役が入れ替わっている`);
});


// ── ハイライトの本数ゲート（2026-09-12）──
// 「毎朝5本」は商品の約束。プロンプトに5点と書いても4本で返る日があるので、生成後に数える。
const issue = (n: number) => {
  const items = [...Array(n)].map((_, i) =>
    `### ${i + 1}. 記事の見出し${i + 1}
*   **何が起きたか**: 起きたこと。
*   **なぜ重要か**: 理由。
*   **実務への影響**: 影響。`,
  ).join('\n\n');
  return `## 🔥 今日のハイライト
${items}

## 🚀 急上昇トレンド
本文。
`;
};

test('ハイライトの本数を ### の数で数える', () => {
  assert.equal(countHighlights(issue(5)), 5);
  assert.equal(countHighlights(issue(4)), 4);
});

test('ハイライト節が無ければ0本（他節の ### を数えない）', () => {
  assert.equal(countHighlights(''), 0);
  assert.equal(countHighlights('## 📊 カテゴリ別トピック\n### LLM推論\n本文。'), 0);
});

test('必要本数は5（変えるときは約束そのものを変えることになる）', () => {
  assert.equal(REQUIRED_HIGHLIGHTS, 5);
});
