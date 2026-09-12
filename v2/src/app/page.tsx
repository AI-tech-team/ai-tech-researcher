import Link from 'next/link';
import { getLandingDigest, getRecentDigests } from './actions';
import { parseDigest, digestReadingSeconds } from '@/lib/digest';
import { BrandNav, BrandFooter } from '@/components/digest/BrandChrome';
import { IssueHeader, BackIssues } from '@/components/digest/IssueHeader';
import { DigestBody } from '@/components/digest/DigestBody';
import { MailCta } from '@/components/digest/MailCta';
import s from '@/styles/brand.module.css';

// トップ ＝ 今朝の朝刊そのもの。
//
// 2026-09-11 まで、ここは旧 Knowledge Tree の記事一覧（無限の川）だった。紹介ページが
// 「毎朝3分・5本」と約束しているのに、その「朝刊を読む」を押すと arXiv の論文が30本並ぶ
// ページに着いていた＝商品の約束がトップで破れていた。川は /articles へ降ろした。
//
// ⚠ ISRを外さないこと。cookies も searchParams も読まないので静的化でき、CDNから配れる
//   （動的に落ちると Vercel が no-store を付けてCDNキャッシュを捨て、全アクセスが
//   関数のコールドスタートを踏む＝本番実測で2.66〜3.83秒）。
//   ログインの有無で出し分けているのは <MailCta> だけで、あれはクライアント側で判定する。
export const revalidate = 300;

export default async function Page() {
  // 一過性のDB失敗を「朝刊が無い日」としてISRに5分焼き付けないため、1回だけ引き直す。
  // getLandingDigest は失敗もデータ無しも null を返すので、ここで区別せずに再試行する。
  let digest = await getLandingDigest();
  if (!digest) {
    await new Promise(r => setTimeout(r, 300));
    digest = await getLandingDigest();
  }

  if (!digest) {
    return (
      <div className={s.page}>
        <BrandNav />
        <main id="main-content" className={`${s.bandInk} ${s.band}`}>
          <div className={s.measure}>
            <p className={`${s.eyebrow} ${s.eyebrowInk}`}>朝刊</p>
            <h1 className={`${s.displayJp} ${s.h2}`}>今朝の朝刊は、<br />まだ出ていません。</h1>
            <p className={s.lead} style={{ marginTop: 26 }}>
              毎朝6時に1号出ます。少し時間をおいてから、もう一度開いてみてください。
            </p>
            <div className={s.row} style={{ marginTop: 34 }}>
              <Link className={`${s.btn} ${s.btnSolid}`} href="/articles">集めた記事を見る</Link>
            </div>
          </div>
        </main>
        <BrandFooter />
      </div>
    );
  }

  const parsed = parseDigest(digest.content);
  const seconds = digestReadingSeconds(digest.content);
  // 現在の号を除いた直近7号。除外のために8件引いて絞る（idの条件でクエリを分けない＝キャッシュが効く）。
  const back = (await getRecentDigests(8)).filter(r => r.id !== digest.id).slice(0, 7);

  return (
    <div className={s.page}>
      <BrandNav />

      <IssueHeader
        eyebrow="朝刊"
        title="今朝の朝刊"
        reportDate={digest.reportDate}
        seconds={seconds}
        picked={parsed.highlights.length}
        pool={digest.collectedFrom}
      />

      <main id="main-content" className={`${s.bandPaper} ${s.paper}`}>
        <DigestBody digest={parsed} />
      </main>

      <section className={`${s.bandInk} ${s.band}`}>
        <div className={s.measure}>
          <p className={`${s.eyebrow} ${s.eyebrowInk}`}>過去の朝刊</p>
          <h2 className={`${s.displayJp} ${s.h2}`}>昨日までの、<br />朝刊。</h2>
          <p className={s.body} style={{ marginTop: 24 }}>
            1日1号、毎朝6時。過ぎた号も同じ形で残してあります。
            朝刊に載らなかった記事は <Link href="/articles">記事を探す</Link> から辿れます。
          </p>
          <BackIssues issues={back} />
        </div>
      </section>

      <section className={`${s.bandInk} ${s.band} ${s.close}`} style={{ paddingTop: 24 }}>
        <div className={s.measure}>
          <h2 className={`${s.displayJp} ${s.h2}`}>明日の朝も、<br />6時に出ます。</h2>
          <p className={s.lead}>開くだけで読めます。登録もログインも要りません。</p>
          <div className={s.row}><MailCta /></div>
          <p className={s.micro}>メールは任意です。1クリックで止められます。</p>
        </div>
      </section>

      <BrandFooter />
    </div>
  );
}
