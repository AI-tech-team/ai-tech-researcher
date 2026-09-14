import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../components/Markdown';

// サイト本体の描画（Markdown.tsx）が、字下げされた箇条書きを取りこぼさないことを守る。
//
// なぜ要るか: 行頭に残った `*` は parseInline の斜体パターンと対になるので、
// 「印が出ない」だけでは済まず **その行の強調が全部1つずつズレる**。
// backup_2026-09-13 の公開142号に 1,138行 / 68号（48%）あり、直近14日でも発生していた。
// → [[pattern-positional-pairing]]

/** React要素ツリーから表示テキストだけを取り出す（react-domを使わずに検査する） */
function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf((node as { props?: { children?: unknown } }).props?.children);
}

const tagsOf = (nodes: unknown[]) =>
  nodes.map((n) => (typeof (n as { type?: unknown })?.type === 'string' ? String((n as { type: string }).type) : '?'));

test('字下げされた箇条書きも箇条書きとして描画する', () => {
  assert.deepEqual(tagsOf(renderMarkdown('    *   **新登場**: 本文')), ['ul']);
  assert.deepEqual(tagsOf(renderMarkdown('  - 本文')), ['ul']);
  assert.deepEqual(tagsOf(renderMarkdown('\t+ 本文')), ['ul']);
});

test('字下げされた箇条書きの本文に「*」が残らない（強調がズレない）', () => {
  const t = textOf(renderMarkdown('    *   **新登場**: サーバーが**逼迫**しました'));
  assert.ok(!t.includes('*'), `「*」が残っている: ${t}`);
  assert.ok(t.includes('新登場'), t);
  assert.ok(t.includes('逼迫'), t);
});

test('字下げの無い従来の箇条書きは今までどおり', () => {
  assert.deepEqual(tagsOf(renderMarkdown('- 本文')), ['ul']);
  assert.equal(textOf(renderMarkdown('- 本文')).includes('本文'), true);
});

test('水平線は箇条書きに吸われない', () => {
  assert.deepEqual(tagsOf(renderMarkdown('---')), ['hr']);
  assert.deepEqual(tagsOf(renderMarkdown('***')), ['hr']);
});
