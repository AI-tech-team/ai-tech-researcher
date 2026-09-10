import type { Metadata } from 'next';
import Link from 'next/link';
import { getLandingDigest } from '@/app/actions';
import { parseHighlights, highlightsReadingSeconds } from '@/lib/digest-highlights';
import { formatReadingTime } from '@/lib/reading-time';
import { SITE_NAME } from '@/lib/site';
import { ReadTimer, SelectionDots } from './ReadTimer';
import s from './about.module.css';

// 紹介ページ。
//
// コンセプト: 忙しい人が3分でAIの動向を知れる状態にする。
// 判定基準は「読者の3分に貢献するか」。しないものは載せない——累計記事数・連続日数・
// 抽出率のような**作り手の実績値は意図的に全部落としてある**（自慢であって読者の役に立たない）。
// 残した数字は「集めた本数 → 載せた本数」と「読了時間」の2つだけ。
//
// 説明を足すより実物を置いた方が早いので、中央に**今朝の朝刊そのもの**を出す。
// 中身はDBの最新dailyから毎回引くので、このページは毎朝入れ替わる。
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'このサービスについて',
  description: `${SITE_NAME} は、毎日およそ200本流れてくるAI技術のニュースから、特に知っておいてほしいものを5本選んで日本語でまとめる朝刊です。読み終わるまで3分。`,
};

export default async function AboutPage() {
  const digest = await getLandingDigest();
  const highlights = digest ? parseHighlights(digest.content) : [];
  const seconds = digest ? highlightsReadingSeconds(digest.content) : 0;

  // 朝刊が引けない／形が崩れているときは、実物の代わりに読み物としての説明だけを出す。
  // 空の紙面を出すより、無いことが分かる方がまし。
  const hasPaper = Boolean(digest) && highlights.length > 0;

  const dateLabel = digest?.reportDate
    ? new Date(`${digest.reportDate}T00:00:00+09:00`).toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    })
    : '';

  return (
    <div className={s.page}>
      <nav className={s.nav}>
        <div className={s.navInner}>
          <Link className={s.navBrand} href="/">{SITE_NAME}</Link>
          <div className={s.navLinks}>
            <a href="#today">今朝の朝刊</a>
            <a href="#select">選び方</a>
            <a href="#promise">約束</a>
          </div>
          <Link className={s.navCta} href="/">朝刊を読む</Link>
        </div>
      </nav>

      {/* ══ ヒーロー ══ */}
      <header className={`${s.band} ${s.bandInk} ${s.hero}`} id="top" style={{ paddingBottom: 0 }}>
        <div className={s.glow} aria-hidden="true" />
        <div className={s.heroInner}>
          <span className={s.pill}><span className={s.pillDot} />毎朝 6:00 JST 更新 · 登録もログインも不要</span>

          <h1 className={`${s.displayJp} ${s.h1}`} style={{ marginTop: 34 }}>
            今朝のAIは、<br />この<span className={`${s.numeral} ${s.grad}`} style={{ fontSize: '1.04em' }}>
              {highlights.length || 5}
            </span>本。
          </h1>

          <p className={s.lead}>
            毎日およそ200本流れてくるAI技術のニュースから、<strong>特に知っておいてほしいもの</strong>を選んで、
            日本語でまとめています。読み終わるまで<strong>{seconds > 0 ? formatReadingTime(seconds) : '3分'}</strong>。
          </p>
          {hasPaper && (
            <p className={s.lead} style={{ marginTop: 14 }}>
              説明より読んでもらったほうが早いので、<strong>今朝の分をそのまま下に置きました。</strong>
            </p>
          )}

          <div className={s.row}>
            <a className={`${s.btn} ${s.btnSolid}`} href="#today">今朝の朝刊を読む</a>
            <a className={`${s.btn} ${s.btnGhost}`} href="#select">選び方を見る&nbsp;›</a>
          </div>
          <p className={s.micro}>無料。読むだけならアカウントは要りません。</p>
        </div>
      </header>

      {/* ══ 朝刊の実物 ══ */}
      {hasPaper && digest && (
        <div className={s.paperWrap} id="today">
          <article className={s.frontpage}>
            <header className={s.fpHead} id="fpHead">
              <div>
                <h2 className={s.fpMast}>今日の朝刊</h2>
                <p className={s.fpDate}>{dateLabel}</p>
              </div>
              <span className={s.fpTimer}><ReadTimer estimateSeconds={seconds} /></span>
            </header>

            {highlights.map((h, i) => (
              <div className={s.fpItem} key={`${i}-${h.title}`}>
                <p className={s.fpNo}>{String(i + 1).padStart(2, '0')}</p>
                <h3 className={s.fpH}>{h.title}</h3>
                {h.points.length > 0 && (
                  <div className={s.fpDl}>
                    {h.points.map(p => (
                      <div className={s.fpDlRow} key={p.label}>
                        <span className={s.fpDt}>{p.label}</span>
                        <p className={s.fpDd}>{p.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <footer className={s.fpEnd} id="fpEnd">
              <p className={s.fpEndLine}>以上、今朝のAIです。</p>
              <p className={s.fpNote}>
                順位は付けていません。{highlights.length}本とも読んでおいてほしくて選んでいます。
              </p>
              <div className={s.fpMore}>
                それぞれの元記事へは <Link href={`/reports/${digest.id}`}>朝刊のページ</Link> から辿れます。
                週次トレンドやカテゴリ別のまとめもその先に続きますが、
                <strong>3分で終わるのはここまでです。</strong>先は読んでも読まなくてかまいません。
              </div>
            </footer>
          </article>
        </div>
      )}

      {/* ══ 選別量 ══ */}
      {digest && digest.collectedFrom > 0 && (
        <section className={`${s.band} ${s.bandInk}`} id="select" style={{ paddingTop: 104 }}>
          <div className={`${s.shellWide} ${s.split}`}>
            <div>
              <p className={`${s.eyebrow} ${s.eyebrowInk}`}>選び方</p>
              <div className={s.ratio}>
                <span className={`${s.numeral} ${s.grad} ${s.ratioN}`}>{digest.collectedFrom}</span>
                <span className={s.ratioArrow}>→</span>
                <span className={`${s.numeral} ${s.grad} ${s.ratioN}`}>{highlights.length || 5}</span>
              </div>
              <h2 className={s.displayJp} style={{ fontSize: 'clamp(1.45rem,3vw,2rem)', marginTop: 22 }}>
                あなたが読まずに済んだ、{Math.max(0, digest.collectedFrom - (highlights.length || 5))}本。
              </h2>
              <p className={s.body} style={{ marginTop: 22 }}>
                前回の朝刊からの間に流れてきたAIのニュースは <strong>{digest.collectedFrom}本</strong>でした。
                同じ出来事を複数の媒体が報じていれば1件に束ね、残りから{highlights.length || 5}本を選んでいます。
              </p>
            </div>
            <div>
              <div className={s.dots} role="img"
                aria-label={`${digest.collectedFrom}個の点のうち${highlights.length || 5}個が色付き。集めた${digest.collectedFrom}本のうち朝刊に載ったのが${highlights.length || 5}本であることを表す図。`}>
                <SelectionDots total={digest.collectedFrom} picked={highlights.length || 5}
                  dotClass="" pickClass={s.dotPick} />
              </div>
              <div className={s.dotsCaption}>
                <span className={s.dotsKey}><b style={{ background: '#1f1f26', boxShadow: '0 0 0 1px #33333c' }} />流れてきた {digest.collectedFrom} 本</span>
                <span className={s.dotsKey}><b style={{ background: '#38bdf8' }} />朝刊に載った {highlights.length || 5} 本</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ══ なぜこの5本なのか ══ */}
      <section className={`${s.band} ${s.bandPaper}`}>
        <div className={s.shell}>
          <p className={`${s.eyebrow} ${s.eyebrowPaper}`}>なぜこの{highlights.length || 5}本なのか</p>
          <h2 className={`${s.displayJp} ${s.h2}`}>{highlights.length || 5}本とも、<br />知っておいてほしいから。</h2>
          <p className={`${s.body} ${s.bodyPaper}`} style={{ marginTop: 28, fontSize: '1.06rem' }}>
            1位から{highlights.length || 5}位ではありません。
            <strong>「3番目だから読み飛ばしていい」という記事は入れていない</strong>ので、順位も★も点数も付けていません。
            全部、渡したくて渡しています。
          </p>

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
                いちばん集中したのは「AppleがOpenAIを営業秘密の窃盗で提訴」で、<strong>25本</strong>の記事が同じ件を報じていました。
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
        <div className={s.shell}>
          <p className={`${s.eyebrow} ${s.eyebrowInk}`}>約束</p>
          <h2 className={`${s.displayJp} ${s.h2}`}>3分を、<br />超えない。</h2>
          <p className={s.body} style={{ marginTop: 28 }}>
            長さは1つだけです。「短い版」と「詳しい版」を選ばせません。
            毎朝この{highlights.length || 5}本が、3分で読み終わる長さで出ます。
          </p>

          <div className={s.facts}>
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

      <footer className={s.foot}>
        <div className={s.footInner}>
          <span>{SITE_NAME} — AI技術の朝刊</span>
          <div className={s.footLinks}>
            <Link href="/privacy">プライバシー</Link>
            <Link href="/terms">利用規約</Link>
            <Link href="/changelog">更新履歴</Link>
          </div>
          <span>読了時間は 600字/分で算出</span>
        </div>
      </footer>
    </div>
  );
}
