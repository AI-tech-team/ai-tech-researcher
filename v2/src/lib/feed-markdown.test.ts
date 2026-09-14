import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, inlineHtml, markdownToFeedHtml, excerpt } from './feed-markdown';

// RSSが配る本文HTML。ルートのファイルの中にあったのでテストから呼べず、
// 4つ目の描画経路として総当たりの対象から漏れていた（2026-09-15に lib へ移動）。

test('見出しは # から #### まで受ける（記号を残さない）', () => {
  assert.ok(markdownToFeedHtml('# 表題').includes('<h2>表題</h2>'));
  assert.ok(markdownToFeedHtml('## 節').includes('<h2>節</h2>'));
  assert.ok(markdownToFeedHtml('### 小節').includes('<h3>小節</h3>'));
  assert.ok(markdownToFeedHtml('#### LLM推論').includes('<h4>LLM推論</h4>'));
  for (const md of ['# A', '## B', '### C', '#### D', '##### E', '###### F']) {
    const text = markdownToFeedHtml(md).replace(/<[^>]+>/g, '');
    assert.ok(!text.includes('#'), `記号が残っている: ${md} -> ${text}`);
  }
});

test('字下げした箇条書きも <li> になる', () => {
  const html = markdownToFeedHtml('    *   **新登場**: 本文');
  assert.ok(html.includes('<ul>'), html);
  assert.ok(html.includes('<li>'), html);
  assert.ok(!html.replace(/<[^>]+>/g, '').includes('*'), html);
});

test('太字の中のコードも記号を残さない', () => {
  const html = inlineHtml('**`torch.compile` のリージョナル**: 短縮。');
  assert.ok(html.includes('<code>torch.compile</code>'), html);
  assert.ok(!html.replace(/<[^>]+>/g, '').includes('`'), html);
});

test('リンクは safeHttpUrl を通ったものだけタグにする', () => {
  assert.ok(inlineHtml('[ラベル](https://example.test/a)').includes('<a href="https://example.test/a">ラベル</a>'));
  for (const bad of ['javascript:alert(1)', 'https://vertexaisearch.cloud.google.com/x']) {
    const html = inlineHtml(`[ラベル](${bad})`);
    assert.ok(!html.includes('<a '), `リンクにしてはいけない: ${bad} -> ${html}`);
    assert.ok(html.includes('ラベル'), html);
  }
});

test('本文は必ずエスケープする（フィードにタグを注入させない）', () => {
  const html = markdownToFeedHtml('本文 <script>alert(1)</script> と "引用" と & 記号');
  assert.ok(!html.includes('<script>'), html);
  assert.ok(html.includes('&lt;script&gt;'), html);
  assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('抜粋に記号を持ち込まない', () => {
  assert.equal(excerpt('## 見出し\n---\n- 項目1\n- 項目2'), '見出し 項目1 項目2');
  assert.ok(!excerpt('`code` と **強調** と [ラベル](https://example.test/)').includes('`'));
});
