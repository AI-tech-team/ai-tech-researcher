import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripIdPrefix } from './title-prefix';

test('プロンプトで渡したidの接頭辞を剥がす', () => {
  // 本番の実データ（id=21984 / 21973）
  assert.equal(
    stripIdPrefix('[21984] Meta公式のEvolution APIとCloud API：WhatsAppを統合する方法', 21984),
    'Meta公式のEvolution APIとCloud API：WhatsAppを統合する方法');
  assert.equal(
    stripIdPrefix('[21973] Google Cloud、垂直プラットフォームでFinanceのAIギャップを埋める', 21973),
    'Google Cloud、垂直プラットフォームでFinanceのAIギャップを埋める');
});

test('idと一致しない角括弧は残す（原題の一部を壊さない）', () => {
  // 本番に実在する原題。ERC8107 は記事idではない
  assert.equal(stripIdPrefix('[ERC8107] AIエージェントの参加をENS名で判定する仕組み', 25374),
    '[ERC8107] AIエージェントの参加をENS名で判定する仕組み');
  assert.equal(stripIdPrefix('[生成AI Vol.4] ClaudeとGitHub Projectsを連携させる', 22796),
    '[生成AI Vol.4] ClaudeとGitHub Projectsを連携させる');
  // 数字でも別の番号なら残す（年号・型番などを消さない）
  assert.equal(stripIdPrefix('[2024] 振り返り', 21943), '[2024] 振り返り');
});

test('空白の揺れを吸収する', () => {
  assert.equal(stripIdPrefix('[ 21943 ]  Intelligence Ageの紹介', 21943), 'Intelligence Ageの紹介');
  assert.equal(stripIdPrefix('  [21943] Intelligence Ageの紹介', 21943), 'Intelligence Ageの紹介');
});

test('接頭辞が無ければそのまま', () => {
  assert.equal(stripIdPrefix('Intelligence Ageの紹介', 21943), 'Intelligence Ageの紹介');
  assert.equal(stripIdPrefix('', 1), '');
});

test('剥がすのは先頭の1つだけ（本文中の角括弧に触らない）', () => {
  assert.equal(stripIdPrefix('[7] Llama [7] の話', 7), 'Llama [7] の話');
});
