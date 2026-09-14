import Link from 'next/link';
import { BrandNav, BrandFooter } from '@/components/digest/BrandChrome';
import s from '@/styles/brand.module.css';

/**
 * DBに繋がらないときに「無い」と言わないための画面。
 *
 * ⚠ これが要る理由（2026-09-14 の読み取り枠切れで実測）:
 *   実在する `/articles/26178` と `/reports/324` が **「記事が見つかりません」** を返していた。
 *   メールと共有リンクで来た読者には、**その記事が存在しないと断言**していたことになる。
 *   しかも 404 の本文には「共有リンクの記事が古い場合もあります」と書いてあり、
 *   こちらの障害なのに**リンクのせいにしていた**。
 *
 * ⚠ もう一つ重い副作用: 個別ページは `revalidate = 3600`。障害中に生成された404は
 *   **1時間キャッシュされる**ので、DBが戻ったあとも最大1時間「見つかりません」を配り続ける。
 *
 * ❌ 訂正（2026-09-15 本番実測）: ここには「notFound() を投げずにこの画面を返せば、その汚染も
 *   起きない」と書いてあったが、**これは誤りだった**。障害中の `/articles/26178` を3秒おきに
 *   3回叩くと `X-Nextjs-Prerender: 1` / `X-Vercel-Cache: HIT` のまま `Age: 79 → 82 → 86` と伸びた。
 *   つまりこの画面も 404 とまったく同じようにISRキャッシュへ格納されている。
 *   **改善したのは文面だけで、キャッシュ汚染の範囲は1ミリも変わっていない。**
 *   （それでも文面の改善には意味がある。「存在しない」と断定するのと「こちらの不具合です」とでは、
 *    読者が次に取る行動が違う。だが「汚染も起きない」と書いたのは測らずに書いた断定だった）
 *
 * ✅ 解決（2026-09-15）: ローカル本番ビルド（`next build --webpack` + `next start`）に
 *   枠切れ中の本番DBを繋げば、障害をそのまま再現できると気づいて実測した。
 *   まず**汚染を再現**: `.next/server/app/articles/26178.html` に障害画面が書き出され
 *   `s-maxage=3600` で配られていた。そのうえで逃げ道を2つ測り、**どちらも使えないと確認**:
 *     ① `throw` → キャッシュは書かれない（docs どおり）。だが ISR の生成中の例外はエラー境界に
 *        落ちず、**素の "Internal Server Error"（21バイト）**が返る。文面ごと消える。
 *     ② `await connection()` → 同じく 500。ISRルートの中では呼べない。
 *        （疑っていたとおり、docs の「ビルド時プリレンダの除外」以上のことはしない）
 *   ⇒ **ISRルートの中で障害を描く限り、キャッシュ汚染か白画面かの二択**になる。
 *   そこで `src/middleware.ts` を直した。DBエラーを握り潰して true を返していた `exists()` を
 *   3値（yes/no/unknown）にし、unknown は**ISRルートに入る前に** `/outage`（force-dynamic）へ
 *   rewrite する。実測: 3ルートとも `no-store` の34KBの画面が出て、ISRファイルは生成されない。
 *
 * ⚠ 交換したもの: middleware はキャッシュより手前で走るので、障害中は**キャッシュ済みの記事も**
 *   この画面になる。ただし `revalidate = 3600` なのでその利点は障害開始から最大1時間しか無く、
 *   防ぐ汚染は障害中ずっと＋復旧後1時間。差し引きで割に合う。
 */
export function OutageNotice({ what }: { what: string }) {
  return (
    <div className={s.page}>
      <BrandNav />
      <main id="main-content" className={`${s.bandInk} ${s.band}`}>
        <div className={s.measure}>
          <p className={`${s.eyebrow} ${s.eyebrowInk}`}>Cernoval</p>
          <h1 className={`${s.displayJp} ${s.h2}`}>いま{what}を<br />お見せできません。</h1>
          <p className={s.lead} style={{ marginTop: 26 }}>
            こちらの不具合です。リンクが間違っているわけではありません。復旧しだい、いつもどおりご覧いただけます。
          </p>
          <div className={s.row} style={{ marginTop: 34 }}>
            <Link className={`${s.btn} ${s.btnSolid}`} href="/">トップに戻る</Link>
          </div>
        </div>
      </main>
      <BrandFooter />
    </div>
  );
}
