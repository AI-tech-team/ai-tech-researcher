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
 * ⚠ 未解決: 障害中の描画だけをISRキャッシュに載せない方法は未確定。`connection()` は
 *   Next.js 16の公式docsでは**ビルド時プリレンダの除外**が用途と書かれているだけで、
 *   実行時のISR格納を止めるとは明記されていない。DBが戻るまで実機で確かめられないので、
 *   推測で入れない。→ docs/recovery-checklist.md
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
