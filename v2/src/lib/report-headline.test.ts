import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportHeadline } from './report-headline';

const DAILY = [
  'AIエンジニア・研究者の皆様へ', '', '2026年9月14日のレポートをお届けします。', '', '---', '',
  '## 🔥 今日のハイライト', '',
  '### 1. 人間によって構築された最後のAI：真の再帰的自己改善に向けて', '',
  '*   **何が起きたか**: 本文', '',
  '### 2. GLM-5.3-FlashモデルがHugging Faceで公開', '',
  '## 🚀 急上昇トレンド', '本文。',
].join('\n');

test('節のラベルではなく1本目の記事名を採る（本番143号中110号がこれで壊れていた）', () => {
  assert.equal(reportHeadline(DAILY, 'レポート'), '人間によって構築された最後のAI：真の再帰的自己改善に向けて');
});

test('### の連番「1. 」は落とす', () => {
  assert.ok(!reportHeadline(DAILY, 'レポート').startsWith('1.'));
});

test('weekly の本文H1より ### を優先する（kickerと同じことを二度言わない）', () => {
  const weekly = '# AI技術動向 週次サマリーレポート\n\n## 🏆 今週の3大トピック\n\n### 🥇 OpenAIの数学的発見を巡る倫理問題\n本文。';
  assert.equal(reportHeadline(weekly, 'レポート'), '🥇 OpenAIの数学的発見を巡る倫理問題');
});

test('### が無ければ節ラベルでない見出しに落ちる', () => {
  assert.equal(reportHeadline('## 🔥 今日のハイライト\n\n## AIの話\n本文。', 'レポート'), 'AIの話');
});

test('節ラベルしか無ければ最初の見出しを使う（空にしない）', () => {
  assert.equal(reportHeadline('## 🔥 今日のハイライト\n本文。', 'レポート'), '🔥 今日のハイライト');
});

test('見出しが1つも無ければ既定値', () => {
  assert.equal(reportHeadline('ただの本文。', 'デイリーレポート 2026-09-14'), 'デイリーレポート 2026-09-14');
  assert.equal(reportHeadline(null, '既定'), '既定');
});

test('太字とリンク記法を剥がす', () => {
  assert.equal(reportHeadline('### **[OpenAI](https://x.test)が発表**\n本文。', 'x'), 'OpenAIが発表');
});
