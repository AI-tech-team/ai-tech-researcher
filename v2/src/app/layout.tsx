import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { Providers } from "@/components/Providers";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { BackToTop } from "@/components/BackToTop";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL, SITE_NAME, SITE_DESC, SITE_TAGLINE, RSS_ALTERNATE_TYPES } from '@/lib/site';

// サイト全体の構造化データ（WebSite＋Organization）。検索ボックス(SearchAction)は
// URLベースの検索結果(?q=)が無いため今は付けない。
const siteJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    // ⚠ isAccessibleForFree は飾りではない。2026-09-13、あるAIアシスタントが本サイトについて
    //   「有料プランがある」「クレジットカードを入力させられる」と事実無根の回答を返し、
    //   そのうえで「実態不明なので登録を控えるべき」と結論していた。決済のしくみは存在しない。
    //   サイトが機械可読な事実を何も出していなかったことが原因なので、ここで明示する。
    //   → 人間向けの同じ事実は /privacy の「持っていないもの」に、確かめ方つきで書いてある。
    {
      '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: SITE_URL, name: SITE_NAME,
      description: SITE_DESC, inLanguage: 'ja', isAccessibleForFree: true,
      publisher: { '@id': `${SITE_URL}/#org` },
      privacyPolicy: `${SITE_URL}/privacy`,
    },
    { '@type': 'Organization', '@id': `${SITE_URL}/#org`, name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/icon-512.png` },
  ],
};

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// 番号・日付・件数を等幅にする（決定「方向Bの意匠を移植」）。欧文のみなので実測で軽い。
// 和文の明朝／ゴシックは端末のものを使う（globals.css の --font-serif を参照）。
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

// スプラッシュのセッションゲート（静的定数・外部入力なし）。sessionStorage不可(プライベートモード等)でも
// catchで握って毎回表示にフォールバックするだけ＝閉じ込めは起きない。
// 保存済みテーマ("light"/"dark")を最初のペイント前に反映する。未選択("system")なら何も貼らず、
// CSS の prefers-color-scheme に任せる（3状態のうち既定を壊さない）。
const THEME_INIT_JS =
  "try{var t=localStorage.getItem('cv_theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}";

const SPLASH_SESSION_GATE_JS =
  "try{if(sessionStorage.getItem('cv_splash')){document.getElementById('cv-splash').style.display='none'}else{sessionStorage.setItem('cv_splash','1')}}catch(e){}";

// 起動スプラッシュ「絞られていく」。
//
// 輪郭のない、ふにゃふにゃした楕円のかたまりが最初にあって、読み込みが進むにつれて**数が減る**。
// 毎朝 200本以上が流れてきて、そこから残るのは数本、という朝刊の仕事そのもの。
//
// 図形に**線も点も使わない**（2026-09-12 本人指示）。1つ1つは中心から外へ透明になる
// 放射グラデーションの楕円で、縁が無い＝境界がどこにも立たない。重なった部分が
// にじんで1つのかたまりに見える。ふにゃふにゃは、楕円ごとに周期の違う
// scale/translate をかけて位相をずらすことで作る（形そのものは変形させない＝コンポジタで済む）。
const SPLASH_BLOB_COLORS = { A: '#a5b4fc', B: '#38bdf8', C: '#fde68a' } as const;
/** かたまりの濃さ（中心 / 46% / 縁）。2026-09-12「もうちょっとはっきりしてほしい」で 0.34/0.16 から上げた。
 *  縁は 0 のまま＝**輪郭は立てない**（線も点も使わない、という決定は維持）。 */
const SPLASH_BLOB_OPACITY = [0.62, 0.3] as const;
/** 最後に残る1つだけは濃くする。重なりが無くなるぶん、同じ濃さだと消えかけに見える。 */
const SPLASH_LAST_OPACITY = [0.92, 0.5] as const;

/** x,y,rx,ry=配置と大きさ / g=夜明けのどの色か（左=藍→右=淡金） /
 *  wob=ゆらぎの周期(s) / ph=位相のずれ(s・負で途中から始める) / out=消え始める時刻(s)。
 *  外側から先に消えて中心が最後まで残る＝かたまりが絞り込まれていくように見せる。
 *
 *  ⚠ out は **3段** にまとめてある（0.10 → 0.22 → 0.34）。1つずつ 0.03s 刻みでずらすと、
 *     短い尺では「連続的に薄くなった」だけに見えて**減ったことが読み取れない**（2026-09-12 コマ撮りで確認）。
 *     9個 → 5個 → 3個 → 1個と段で落とすと、同じ0.44sでも「絞られていく」が読める。
 *     角4つ → 上下2つ → 左右2つ、の順で外から内へ。段の中の並びは対称にすること。
 *
 *  ⚠ out は globals.css の `.splash` のフェード開始(0.46s)より前に終わること
 *     （最後の 0.34s + 消える時間 0.10s = 0.44s < 0.46s）。2026-09-12 に全体を約0.55倍へ短縮した
 *     （トップの LCP 612ms に対しスプラッシュが 1,716ms 覆っていたため）。 */
const SPLASH_BLOBS = [
  // ⚠ 置きどころを広げすぎない。x を ±44 まで離したら、濃くしたぶん**別々の円に見えた**
  //    （screen で1つの光のかたまりに見えるのが前提・一度その状態から直している）。±32 に戻してある。
  // 第1段: 四隅
  { x: 68, y: 52, rx: 40, ry: 34, g: 'A', wob: 1.3, ph: -0.4, out: 0.10 },
  { x: 132, y: 50, rx: 40, ry: 34, g: 'C', wob: 1.1, ph: -0.7, out: 0.10 },
  { x: 70, y: 90, rx: 40, ry: 34, g: 'A', wob: 1.5, ph: -0.9, out: 0.10 },
  { x: 130, y: 92, rx: 40, ry: 34, g: 'C', wob: 1.2, ph: -0.2, out: 0.10 },
  // 第2段: 上下
  { x: 100, y: 42, rx: 40, ry: 32, g: 'B', wob: 1.0, ph: -0.5, out: 0.22 },
  { x: 100, y: 102, rx: 40, ry: 32, g: 'B', wob: 1.4, ph: -1.1, out: 0.22 },
  // 第3段: 左右
  { x: 80, y: 70, rx: 44, ry: 38, g: 'B', wob: 1.2, ph: -0.8, out: 0.34 },
  { x: 120, y: 70, rx: 44, ry: 38, g: 'B', wob: 1.3, ph: -0.3, out: 0.34 },
  // 最後の1つ。スプラッシュ自体が消えるまで残る（out を届かない時刻に置く）。
  { x: 100, y: 70, rx: 50, ry: 42, g: 'Last', wob: 1.6, ph: -0.6, out: 9 },
] as const;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — ${SITE_TAGLINE}`, template: `%s — ${SITE_NAME}` },
  description: SITE_DESC,
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESC,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: 'ja_JP',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESC,
  },
  alternates: {
    // RSSリーダ/ブラウザがレポートフィードを自動検出できるように <link rel="alternate"> を出す
    types: RSS_ALTERNATE_TYPES,
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: SITE_NAME,
  },
};

// タップ遅延を避けるためのviewport明示（width=device-width）。テーマ色も指定。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // manifest.ts の theme_color と同値にすること（片方だけ変えると、
  // ブラウザのUIとPWAのスタンドアロン表示で色が食い違う）。
  themeColor: '#000000',
};

export default function RootLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  return (
    <html lang="ja" className={`${inter.variable} ${plexMono.variable} h-full antialiased`} suppressHydrationWarning>
      {/* 読者が選んだテーマを、描画前に html へ貼る。ここでやらないと
          「明を選んでいるのに一瞬暗い画面が出る」チラつきが必ず出る。 */}
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_JS }} /></head>
      <body className="min-h-full">
        {/* アクセシビリティ: キーボード/スクリーンリーダー向けのスキップリンク（Tabで最初に当たる） */}
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-sky-600 focus:text-white focus:text-sm focus:font-bold">
          メインコンテンツへスキップ
        </a>
        {/* 起動スプラッシュ「絞られていく」: 輪郭のない楕円のかたまりが、読むにつれて減る。
            サーバー描画＋CSSのみで完結（Reactハイドレーションに依存しない）。
            旧実装はJSタイマー＋visibility付きCSSで消していたが、どちらもメインスレッド依存のため
            ハイドレーション中(数秒)はアニメが凍って居座った。opacityのみのフェード（コンポジタ駆動）に変更。
            直後のインラインscriptで「同一セッション2回目以降は出さない」(sessionStorage)。 */}
        <div aria-hidden id="cv-splash" className="splash">
          {/* ⚠ viewBox はゆらぎで膨らむぶん（最大1.24倍＋translate 5）を外に取る。きつく切ると
              かたまりの縁が箱で切れて「輪郭が無い」という前提が崩れる。
              振れ幅を上げた（2026-09-12「もうちょっとはっきり」）ので余白も広げてある。 */}
          <svg width="440" height="336" viewBox="-10 -12 220 168" fill="none">
            <defs>
              {/* 中心から外へ透明になる＝縁が立たない。夜明けの3色ぶん用意して、
                  左（藍）→中（水色）→右（淡金）に置く＝かたまり全体が夜明けの色になる。 */}
              {(Object.keys(SPLASH_BLOB_COLORS) as (keyof typeof SPLASH_BLOB_COLORS)[]).map(k => (
                <radialGradient key={k} id={`cvBlob${k}`}>
                  <stop offset="0%" stopColor={SPLASH_BLOB_COLORS[k]} stopOpacity={SPLASH_BLOB_OPACITY[0]} />
                  <stop offset="46%" stopColor={SPLASH_BLOB_COLORS[k]} stopOpacity={SPLASH_BLOB_OPACITY[1]} />
                  <stop offset="100%" stopColor={SPLASH_BLOB_COLORS[k]} stopOpacity="0" />
                </radialGradient>
              ))}
              <radialGradient id="cvBlobLast">
                <stop offset="0%" stopColor={SPLASH_BLOB_COLORS.B} stopOpacity={SPLASH_LAST_OPACITY[0]} />
                <stop offset="46%" stopColor={SPLASH_BLOB_COLORS.B} stopOpacity={SPLASH_LAST_OPACITY[1]} />
                <stop offset="100%" stopColor={SPLASH_BLOB_COLORS.B} stopOpacity="0" />
              </radialGradient>
            </defs>
            <g className="splash__blobs">
              {SPLASH_BLOBS.map(b => (
                <ellipse key={`${b.x}-${b.y}`} cx={b.x} cy={b.y} rx={b.rx} ry={b.ry}
                  fill={`url(#cvBlob${b.g})`}
                  style={{
                    // 1つ目=ゆらぎ（無限）、2つ目=消える（1回）。順番は CSS の animation-name と対応。
                    animationDuration: `${b.wob}s, 0.10s`,
                    animationDelay: `${b.ph}s, ${b.out}s`,
                  }} />
              ))}
            </g>
          </svg>
        </div>
        {/* 同一セッション2回目以降はスプラッシュを出さない（描画前に同期実行する必要があるためインライン）。
            第一条の dangerouslySetInnerHTML 禁止は動的データのXSS防止が趣旨。ここは下の静的定数のみで
            外部入力を一切含まないため安全（Next公式のインラインscriptパターン）。 */}
        <script dangerouslySetInnerHTML={{ __html: SPLASH_SESSION_GATE_JS }} />
        <ServiceWorkerRegistrar />
        <Providers>
          <ToastProvider>
            {children}
            {modal}
          </ToastProvider>
        </Providers>
        <BackToTop />
        {/* Cookieレス・匿名のアクセス解析（PIIを集めない方針と両立）。Vercel側でWeb Analytics有効化が必要 */}
        <Analytics />
        <JsonLd data={siteJsonLd} />
      </body>
    </html>
  );
}
