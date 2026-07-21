import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMainText } from './feeds';

// 本文抽出: <article>/<main>優先で、script/style/navを除去しエンティティを復号する。
test('extractMainText: scriptを除去して本文だけ返す', () => {
  const html = '<article><script>evil()</script><p>Hello world</p></article>';
  assert.equal(extractMainText(html), 'Hello world');
});

test('extractMainText: nav/style等を除去', () => {
  const html = '<main><nav>メニュー</nav><style>.x{}</style>本文テキスト</main>';
  assert.equal(extractMainText(html), '本文テキスト');
});

test('extractMainText: HTMLエンティティを復号', () => {
  const html = '<article>A &amp; B &lt;tag&gt; &quot;q&quot; &#39;s&#39;</article>';
  assert.equal(extractMainText(html), `A & B <tag> "q" 's'`);
});

test('extractMainText: article/mainが無ければ全体から抽出', () => {
  const html = '<div><p>本文のみ</p></div>';
  assert.equal(extractMainText(html), '本文のみ');
});

// 回帰(2026-07-21): サイドバーの関連記事カードが先頭<article>にあるレイアウトで、
// 旧実装は「最初にマッチした<article>」を本文とみなし小片(44〜100字)を返していた。
// 本番の9to5mac/huggingface等がこれで too_short 判定になっていた。
test('extractMainText: 先頭の小さな<article>でなく最長のブロックを本文とする', () => {
  const html =
    '<article>関連記事カード</article>' +
    '<article>もう一つのカード</article>' +
    '<main><p>' + 'これが本当の本文です。'.repeat(20) + '</p></main>';
  const got = extractMainText(html);
  assert.ok(got.startsWith('これが本当の本文です。'), `本文が取れていない: ${got.slice(0, 40)}`);
  assert.ok(got.length > 100, `短すぎる: ${got.length}字`);
});

test('extractMainText: <article>が本文なら<main>より長い方が選ばれる', () => {
  const html =
    '<main><p>短いラッパ</p></main>' +
    '<article><p>' + '本文本文。'.repeat(30) + '</p></article>';
  assert.ok(extractMainText(html).startsWith('本文本文。'));
});
