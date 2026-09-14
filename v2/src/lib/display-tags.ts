// 記事に `#タグ` として見せてよいものだけに絞る。
//
// ⚠ なぜ要るか（2026-09-15・backup_2026-09-13 実測）:
//   タグ総数 8,373件のうち、**話題を表しているのは 2,765件（33.0%）だけ**だった。
//   残りは全部、収集の内部メタデータがそのまま読者に出ていたもの:
//     `hn-score:770` 681件 / ホスト名 `techcrunch.com` `lobste.rs` 1,728件 /
//     ソース名 `hn` `arxiv` `zenn` `qiita` 3,199件
//   しかも収集側は `[item.src, item.domain]` を**先頭に**入れるため、記事ページの
//   `slice(0, 6)` がメタデータで埋まり、**本来の話題タグが押し出されていた**
//   （[[pattern-throughput-starvation]]: 上限を先に当てると、枠が要らないもので埋まる）。
//   ソース名は `sourceValue` として別に表示済みなので、タグとしては重複でもある。
//
// ⚠ DBは変更しない。`/tag/arxiv` のようなURLは今までどおり開ける。
//   ここで止めるのは「記事の下に並べて読者に押させること」だけ（回復可能な側に掛ける＝
//   [[pattern-filter-by-recoverability]]）。

/** `hn-score:770` のような「内部キー:数値」形式 */
const INTERNAL_KV_RE = /^[a-z][a-z0-9-]*:[0-9.]+$/i;

/** ホスト名（`techcrunch.com` `lobste.rs` `brew.sh`）。ドットを含む技術名は下の例外で守る。 */
const HOSTNAME_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/i;

/**
 * ドットを含むが話題タグである既知の名前。
 * 実測の685種にこの形は1つも無かったが、`next.js` の類が将来入ってきたときに
 * ホスト名として消さないための保険。
 */
const DOTTED_TOPICS = new Set([
  'next.js', 'node.js', 'nuxt.js', 'vue.js', 'three.js', 'd3.js', 'express.js',
  'llama.cpp', 'socket.io', 'asp.net', 'vite.js', 'deno.js',
]);

/** 収集元の名前。話題ではないうえ、sourceValue として別に出している。 */
const SOURCE_LABELS = new Set([
  'hn', 'hacker-news', 'hackernews', 'hatena', 'zenn', 'qiita', 'youtube',
  'arxiv', 'github', 'reddit', 'note', 'techdrip', 'gareso', 'rss',
]);

/** 記事の下に `#タグ` として出してよいか。 */
export function isDisplayableTag(tag: string): boolean {
  const t = (tag ?? '').trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (DOTTED_TOPICS.has(lower)) return true;
  if (INTERNAL_KV_RE.test(t)) return false;
  if (HOSTNAME_RE.test(t)) return false;
  if (SOURCE_LABELS.has(lower)) return false;
  return true;
}

/**
 * 表示するタグを選ぶ。**絞ってから上限を当てる**（逆にすると枠がメタデータで埋まる）。
 */
export function displayTags(tags: string[] | null | undefined, limit: number): string[] {
  return (tags ?? []).filter(isDisplayableTag).slice(0, limit);
}
