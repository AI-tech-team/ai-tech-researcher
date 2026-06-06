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
