/**
 * RSS/Atom/RDF フィードから記事の項目を取り出す。
 *
 * daily_pipeline.ts の中に直書きされていたものを、**テストできる場所へ出した**。
 * 出した理由: `<item rdf:about="...">` を1件も拾えないバグが入っていたのに、
 * フィードは HTTP 200 を返し、収集は「0件成功」で終わり、`last_hit_at` も更新されるため
 * **どこにも異常が出なかった**。本番で2フィード×計55件/日が数か月見えていなかった
 * （2026-09-13 実測: anond.hatelabo.jp 25件中0件 / feeds.japan.cnet.com 30件中0件）。
 * パーサは形式ごとの実物で回帰を張れる純粋関数なので、ここに置く。
 */
import { decodeHtmlEntities } from './html-entities';

export interface FeedItem {
  title: string;
  link: string;
  description: string;
  /** 元の文字列のまま返す（形式がばらばらなので日付解釈は呼び出し側に任せる） */
  pubDate: string;
}

/** タグの中身を取り出す。CDATA を剥がし、HTMLエンティティを解く。 */
function tagText(chunk: string, tag: string): string {
  const m = chunk.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  // ここでデコードすると title と description の両方に効く。素通しだと `Apple&#039;s` が
  // そのままメール本文に出て、`GPT&#45;5.6 Sol` は固有名が割れる（2026-09-10 監査・本番1,483件）。
  return decodeHtmlEntities((m?.[1] ?? '').trim());
}

export function parseFeedItems(xml: string): FeedItem[] {
  const isAtom = /<entry[\s>]/i.test(xml);
  const itemTag = isAtom ? 'entry' : 'item';

  // ⚠ 開始タグの**属性を許すこと**。`<item>` だけで書いていた頃、RSS 1.0/RDF 形式の
  //   `<item rdf:about="...">` が1件も一致しなかった。
  //   `[^>]*` でなく `(?:\s[^>]*)?` にするのは `<items>` のような別タグに誤爆させないため。
  const itemRegex = new RegExp(`<${itemTag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${itemTag}>`, 'gi');

  const items: FeedItem[] = [];
  for (const chunk of xml.match(itemRegex) ?? []) {
    const title = tagText(chunk, 'title');
    // Atom は <link href="url"/> 形式を使う
    const link = isAtom
      ? (chunk.match(/<link[^>]+href="([^"]+)"/i)?.[1] ?? tagText(chunk, 'link'))
      : tagText(chunk, 'link');
    const description = isAtom
      ? (tagText(chunk, 'summary') || tagText(chunk, 'content')).replace(/<[^>]*>/g, '').slice(0, 500)
      : tagText(chunk, 'description').replace(/<[^>]*>/g, '').slice(0, 500);
    // ⚠ RSS 1.0/RDF は <pubDate> を持たず <dc:date> を使う。取りこぼすと pubDate 空＝
    //   「日付不明なので通す」扱いになり、何年前の記事でも鮮度の窓を素通りする。
    const pubDate = isAtom
      ? (tagText(chunk, 'updated') || tagText(chunk, 'published'))
      : (tagText(chunk, 'pubDate') || tagText(chunk, 'dc:date'));
    if (title && link) items.push({ title, link, description, pubDate });
  }
  return items;
}

/**
 * 発行日が `sinceMs` 以降のものだけ残す。
 * ⚠ 日付が取れない／解釈できないものは**落とさず通す**。フィード側の日付表記は壊れていることが
 *   あり、そこで落とすと「日付が変なサイトの記事だけ永久に入らない」という静かな欠落になる。
 */
export function filterByDate(items: FeedItem[], sinceMs: number): FeedItem[] {
  return items.filter(item => {
    if (!item.pubDate) return true;
    const d = new Date(item.pubDate).getTime();
    return isNaN(d) || d >= sinceMs;
  });
}
