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
