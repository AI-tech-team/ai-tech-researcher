import type { Metadata } from 'next';
import Link from 'next/link';
import { getLandingDigest } from '@/app/actions';
import { parseHighlights } from '@/lib/digest-highlights';
import { digestReadingSeconds } from '@/lib/digest';
import { formatReadingTime } from '@/lib/reading-time';
import { SITE_NAME, RSS_ALTERNATE_TYPES } from '@/lib/site';
import { BrandNav, BrandFooter } from '@/components/digest/BrandChrome';
import { SelectionDots } from './SelectionDots';
import s from '@/styles/brand.module.css';

// 紹介ページ。**何のために作ったか**を書く場所であって、朝刊そのものを読ませる場所ではない。
// 朝刊は トップ と /reports にある。ここに実物を丸ごと置くと同じ内容が二重になり、
// 「3分で読める朝刊」の紹介ページ自体が4分50秒・モバイル9画面になっていた（2026-09-11 実測で撤去）。
//
// コンセプト: 忙しい人が3分でAIの動向を知れる状態にする。
// 判定基準は「読者の3分に貢献するか」。しないものは載せない——累計記事数・連続日数・
// 抽出率のような**作り手の実績値は意図的に全部落としてある**（自慢であって読者の役に立たない）。
//
// ⚠ 誇張しない。ここに出す数字は本番の実データだけで、書く前に1件ずつ照合する。
//   「3分」は**仕様としての約束**であって「毎日3分でした」という実績の主張ではない。
//   実際、生成側を直す前は13日中8日が3分を超えていた（2026-09-11 実測）。だから約束は
//   「3分で読み終わる長さで出す」と書き、実績は今朝の実測値をそのまま添えるにとどめる。
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'このサービスについて',
  description: `${SITE_NAME} は、1日およそ100〜300本流れてくるAI技術のニュースから、特に知っておいてほしいものだけを選んで日本語でまとめる朝刊です。毎朝6時、3分で読み終わる長さで出します。`,
  alternates: { canonical: '/about', types: RSS_ALTERNATE_TYPES },
};

export default async function AboutPage() {
  const digest = await getLandingDigest();
  const highlights = digest ? parseHighlights(digest.content) : [];
  // ⚠ 号「全体」で測る。以前はハイライトだけを測っていたため、トップの号見出しが4分53秒と
  //   出しているのにこのページは2分25秒と書いていた（同じ朝の同じ号で2つの数字）。
  //   読者に約束しているのは「1号を読み終わるまで」なので digestReadingSeconds に統一する。
  const seconds = digest ? digestReadingSeconds(digest.content) : 0;
  // 今朝の実データが引けないときは、本数に依存する文だけを落とす（推定値で埋めない）。
  const picked = highlights.length;
  const pool = digest?.collectedFrom ?? 0;
  const hasToday = picked > 0 && pool > 0;

  return (
    <div className={s.page}>
      <BrandNav />

      {/* ══ ヒーロー ══ */}
      <header className={`${s.band} ${s.bandInk} ${s.hero}`} id="top">
        <div className={s.glow} aria-hidden="true" />
        <div className={s.heroInner}>
          <span className={s.pill}><span className={s.pillDot} />毎朝 6:00 JST 更新 · 登録もログインも不要</span>

          <h1 className={`${s.displayJp} ${s.h1}`} style={{ marginTop: 34 }}>
            AIの動向を、<br />毎朝<span className={`${s.numeral} ${s.grad}`} style={{ fontSize: '1.04em' }}>3</span>分で。
          </h1>

          <p className={s.lead}>
            AI技術のニュースは1日におよそ<strong>100〜300本</strong>流れてきます。
            全部は追えないので、<strong>特に知っておいてほしいものだけ</strong>を選んで、日本語でまとめています。
          </p>
          <p className={s.lead} style={{ marginTop: 14 }}>
            それが朝刊です。毎朝6時に出ます。
          </p>

          <div className={s.row}>
            <Link className={`${s.btn} ${s.btnSolid}`} href="/">今朝の朝刊を読む</Link>
            <a className={`${s.btn} ${s.btnGhost}`} href="#select">選び方を見る&nbsp;›</a>
          </div>
          <p className={s.micro}>無料。読むだけならアカウントは要りません。</p>
        </div>
      </header>

      {/* ══ 選び方 ══ */}
      <section className={`${s.band} ${s.bandInk}`} id="select" style={{ paddingTop: 96 }}>
        <div className={`${s.shellWide} ${s.split}`}>
          <div>
            <p className={`${s.eyebrow} ${s.eyebrowInk}`}>選び方</p>
            {hasToday ? (
              <>
                <div className={s.ratio}>
                  <span className={`${s.numeral} ${s.grad} ${s.ratioN}`}>{pool}</span>
                  <span className={s.ratioArrow}>→</span>
                  <span className={`${s.numeral} ${s.grad} ${s.ratioN}`}>{picked}</span>
                </div>
                <h2 className={s.displayJp} style={{ fontSize: 'clamp(1.45rem,3vw,2rem)', marginTop: 22 }}>
                  今朝は、{pool}本から{picked}本。
                </h2>
                <p className={s.body} style={{ marginTop: 22 }}>
                  前回の朝刊からの間に流れてきたAIのニュースが <strong>{pool}本</strong>。
                  同じ出来事を複数の媒体が報じていれば1件に束ね、残りから{picked}本を選びました。
                  <strong>この比率は日によって変わります</strong>——流れてくる量が日に100本の日も300本の日もあるからです。
                </p>
              </>
            ) : (
              <>
                <h2 className={s.displayJp} style={{ fontSize: 'clamp(1.45rem,3vw,2rem)', marginTop: 22 }}>
                  1日に数百本から、<br />数本へ。
                </h2>
                <p className={s.body} style={{ marginTop: 22 }}>
                  同じ出来事を複数の媒体が報じていれば1件に束ね、残りから選びます。
                </p>
              </>
            )}
          </div>
          {hasToday && (
            <div>
              <div className={s.dots} role="img"
                aria-label={`${pool}個の点のうち${picked}個が色付き。今朝集めた${pool}本のうち朝刊に載ったのが${picked}本であることを表す図。`}>
                <SelectionDots total={pool} picked={picked} dotClass="" pickClass={s.dotPick} />
              </div>
              <div className={s.dotsCaption}>
                <span className={s.dotsKey}><b style={{ background: '#1f1f26', boxShadow: '0 0 0 1px #33333c' }} />流れてきた {pool} 本</span>
                <span className={s.dotsKey}><b style={{ background: '#38bdf8' }} />朝刊に載った {picked} 本</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ══ 何を基準に選ぶか ══ */}
      <section className={`${s.band} ${s.bandPaper}`}>
        <div className={s.shellWide}>
          <p className={`${s.eyebrow} ${s.eyebrowPaper}`}>基準</p>
          <div className={s.headSplit}>
            <h2 className={`${s.displayJp} ${s.h2}`}>順位は、<br />付けません。</h2>
            <p className={`${s.body} ${s.bodyPaper}`} style={{ fontSize: '1.06rem', maxWidth: 'none' }}>
              1位から{picked || 5}位ではありません。
              <strong>「3番目だから読み飛ばしていい」という記事は入れていない</strong>ので、順位も★も点数も付けていません。
              全部、渡したくて渡しています。
            </p>
          </div>

          <div className={s.facts}>
            <div className={s.fact}>
              <p className={s.factT}>添えるのは、数えただけの事実</p>
              <p className={s.factD}>
                「何本の記事が同じ件を報じたか」「初出はいつか」。どちらも数えれば出る事実です。
                機械に重要度を採点させて、その点数を読者に見せることはしません。判断はあなたがしてください。
              </p>
            </div>
            <div className={s.fact}>
              <p className={s.factT}>同じ出来事は、1件に束ねる</p>
              <p className={s.factD}>
                これまででいちばん集中したのは「AppleがOpenAIを営業秘密の窃盗で提訴」で、<strong>25本</strong>の記事が同じ件を報じていました。
                それが25枠を占めたら、あなたの3分が1件で終わります。だから束ねます。
              </p>
            </div>
            <div className={s.fact}>
              <p className={s.factT}>読めなかった記事は、朝刊に入れない</p>
              <p className={s.factD}>
                元サイトの方針で本文を取得しない場合や、本文がテキストで配信されていない場合があります。
                見出しだけを見て要約を書くことはしないので、そういう記事は朝刊に上げません。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 約束 ══ */}
      <section className={`${s.band} ${s.bandInk}`} id="promise">
        <div className={s.shellWide}>
          <p className={`${s.eyebrow} ${s.eyebrowInk}`}>約束</p>
          <div className={s.headSplit}>
            <h2 className={`${s.displayJp} ${s.h2}`}>3分を、<br />超えない。</h2>
            <p className={s.body} style={{ maxWidth: 'none' }}>
              長さは1つだけです。「短い版」と「詳しい版」を選ばせません。
              毎朝、3分で読み終わる長さで出します。
              {seconds > 0 && <>ちなみに今朝の分は<strong>{formatReadingTime(seconds)}</strong>でした（600字/分で算出）。</>}
            </p>
          </div>

          <div className={`${s.facts} ${s.factsInk}`}>
            <div className={`${s.fact} ${s.factInk}`}>
              <p className={s.factT}>全文は載せない</p>
              <p className={s.factD}>
                載せるのは本紙が書いた要約だけです。記事の全文は権利者の元記事へご案内します。
                気になった1本だけ、原文まで行ってください。
              </p>
            </div>
            <div className={`${s.fact} ${s.factInk}`}>
              <p className={s.factT}>追跡しない</p>
              <p className={s.factD}>
                IPアドレスもユーザーエージェントも収集しません。読むだけならログインは不要です。
                メール配信を使うときだけアドレスをお預かりし、1クリックで停止できます。
                詳しくは <Link href="/privacy">プライバシーポリシー</Link>へ。
              </p>
            </div>
            <div className={`${s.fact} ${s.factInk}`}>
              <p className={s.factT}>断定しない</p>
              <p className={s.factD}>
                要約はAIによる生成物で、誤りを含みます。重要な判断の前には元記事をご確認ください。
                この但し書きを畳んで隠すこともしません。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ══ はじめ方 ══ */}
      <section className={`${s.band} ${s.bandInk} ${s.close}`} style={{ paddingTop: 24 }}>
        <div className={s.shell}>
          <h2 className={`${s.displayJp} ${s.h2}`}>明日の朝も、<br />6時に出ます。</h2>
          <p className={s.lead}>開くだけで読めます。登録もログインも要りません。</p>
          <div className={s.row}>
            <Link className={`${s.btn} ${s.btnSolid}`} href="/">朝刊を読む</Link>
          </div>
          <p className={s.micro}>Googleでログインすると、毎朝メールでも受け取れます（任意・1クリックで停止）。</p>
        </div>
      </section>

      <BrandFooter />
    </div>
  );
}
