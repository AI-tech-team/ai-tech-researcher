import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mailMarkdownToHtml } from './mail-markdown';

// ── 2026-09-15 の回帰: 購読者に送った全メールで素の「*」が本文に出ていた ──
// LLMは `*   ` を好んで出す。本番143号中138号がこの記法で、1号目(2026-05-16)からずっとだった。
test('アスタリスク3スペースの箇条書き（本番の実際の記法）をリスト化する', () => {
  const html = mailMarkdownToHtml('*   **何が起きたか**: 本文\n*   **出典**: arxiv.org');
  assert.equal((html.match(/<li/g) ?? []).length, 2);
  assert.equal((html.match(/<ul/g) ?? []).length, 1);
  assert.ok(!/>\s*\*/.test(html), `素の * が残っている: ${html}`);
});

test('ハイフンの箇条書きも従来どおり動く', () => {
  const html = mailMarkdownToHtml('- ひとつ\n- ふたつ');
  assert.equal((html.match(/<li/g) ?? []).length, 2);
});

test('水平線は <hr> にする（素の --- を本文に出さない）', () => {
  const html = mailMarkdownToHtml('前文\n\n---\n\n## 見出し');
  assert.ok(html.includes('<hr'), html);
  assert.ok(!/(^|>)\s*---/.test(html), `素の --- が残っている: ${html}`);
});

test('--- を箇条書きと誤認しない', () => {
  assert.ok(!mailMarkdownToHtml('---').includes('<li'));
});

test('行頭でない * や、空白の無い *強調* は箇条書きにしない', () => {
  assert.ok(!mailMarkdownToHtml('*強調っぽい* 文').includes('<li'));
  assert.ok(!mailMarkdownToHtml('文中に * がある').includes('<li'));
});

test('太字・コード・見出しは従来どおり', () => {
  const html = mailMarkdownToHtml('## 見出し\n### 小見出し\n**太字** と `code`');
  assert.ok(html.includes('<h2'));
  assert.ok(html.includes('<h3'));
  assert.ok(html.includes('<strong>太字</strong>'));
  assert.ok(html.includes('<code'));
});

test('字下げした入れ子の箇条書きも拾う（5月の号の記法・143号で1,133箇所）', () => {
  const html = mailMarkdownToHtml('    * **実践的ヒント:** 本文');
  assert.ok(html.includes('<li'), html);
  assert.ok(!/>\s*\*/.test(html), `素の * が残っている: ${html}`);
});

// 見出しは1本の規則で全レベルを処理する。以前は ## と ### だけを別々に書いていたため、
// `#`（週次/月次の表題）と `####` が素通りし、メール本文に記号のまま出ていた。
test('見出しは # から #### まで全部タグになる（記号を残さない）', () => {
  assert.match(mailMarkdownToHtml('# 週次サマリー'), /<h1[^>]*>週次サマリー<\/h1>/);
  assert.match(mailMarkdownToHtml('## 今日のハイライト'), /<h2[^>]*>今日のハイライト<\/h2>/);
  assert.match(mailMarkdownToHtml('### 見出し3'), /<h3[^>]*>見出し3<\/h3>/);
  assert.match(mailMarkdownToHtml('#### LLM推論'), /<h4[^>]*>LLM推論<\/h4>/);
  for (const md of ['# A', '## B', '### C', '#### D', '##### E', '###### F']) {
    const text = mailMarkdownToHtml(md).replace(/<[^>]+>/g, '');
    assert.ok(!text.includes('#'), `記号が残っている: ${md} -> ${text}`);
  }
});

test('見出しの順序の罠: ## が「# 」に食われない', () => {
  const text = mailMarkdownToHtml('## 今日のハイライト').replace(/<[^>]+>/g, '');
  assert.equal(text.trim(), '今日のハイライト');
});

test('リンクはタグになり、危険なURLはラベルだけ残す', () => {
  const ok = mailMarkdownToHtml('参考: [Mixtral 8x22B](https://www.itmedia.co.jp/news/a.html)');
  assert.match(ok, /<a href="https:\/\/www\.itmedia\.co\.jp\/news\/a\.html"[^>]*>Mixtral 8x22B<\/a>/);
  // safeHttpUrl が弾くもの（javascript: / グラウンディング中継URL）はラベルだけ出してリンクにしない
  for (const bad of ['javascript:alert(1)', 'https://vertexaisearch.cloud.google.com/x']) {
    const html = mailMarkdownToHtml(`[ラベル](${bad})`);
    assert.ok(!html.includes('<a '), `リンクにしてはいけない: ${bad} -> ${html}`);
    assert.ok(html.includes('ラベル'), html);
  }
});
