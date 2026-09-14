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
 *   notFound() を投げずにこの画面を返せば、その汚染も起きない。
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
