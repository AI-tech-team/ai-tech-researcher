import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { Providers } from "@/components/Providers";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { BackToTop } from "@/components/BackToTop";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL, SITE_NAME, SITE_DESC, SITE_TAGLINE } from '@/lib/site';

// サイト全体の構造化データ（WebSite＋Organization）。検索ボックス(SearchAction)は
// URLベースの検索結果(?q=)が無いため今は付けない。
const siteJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: SITE_URL, name: SITE_NAME, description: SITE_DESC, inLanguage: 'ja' },
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

// 起動スプラッシュの点の配置。7列×4行のうち5点だけが夜明けの色で灯る＝毎朝の選別そのもの。
// 5という数はハイライトの本数（＝商品の約束）に合わせてある。
const SPLASH_COLS = [12, 32, 52, 72, 92, 112, 132];
const SPLASH_ROWS = [14, 34, 54, 74];
const SPLASH_PICKS: [number, number][] = [[52, 14], [12, 34], [92, 34], [132, 54], [32, 74]];

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
    types: { 'application/rss+xml': `${SITE_URL}/feed.xml` },
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
  themeColor: '#03060f',
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
        {/* 起動スプラッシュ「選別」: たくさんの点のうち5点だけが夜明けの色で灯る。
            サーバー描画＋CSSのみで完結（Reactハイドレーションに依存しない）。
            旧実装はJSタイマー＋visibility付きCSSで消していたが、どちらもメインスレッド依存のため
            ハイドレーション中(数秒)はアニメが凍って居座った。opacityのみのフェード（コンポジタ駆動）に変更。
            直後のインラインscriptで「同一セッション2回目以降は出さない」(sessionStorage)。 */}
        <div aria-hidden id="cv-splash" className="splash">
          <svg width="216" height="132" viewBox="0 0 144 88">
            <defs>
              {/* 夜明け（藍→水色→淡金）。userSpaceOnUse なので5点が空の別々の場所の色になる。 */}
              <linearGradient id="cvDawn" gradientUnits="userSpaceOnUse" x1="0" y1="88" x2="144" y2="0">
                <stop offset="0%" stopColor="#a5b4fc" />
                <stop offset="38%" stopColor="#38bdf8" />
                <stop offset="88%" stopColor="#fde68a" />
              </linearGradient>
              <radialGradient id="cvGlow">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse className="splash__glow" cx="72" cy="46" rx="84" ry="50" fill="url(#cvGlow)" />
            <g className="splash__grid" fill="#2b2b34">
              {SPLASH_ROWS.flatMap(y => SPLASH_COLS.map(x => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="3.4" />
              )))}
            </g>
            <g className="splash__picks" fill="url(#cvDawn)">
              {SPLASH_PICKS.map(([x, y]) => <circle key={`p${x}-${y}`} cx={x} cy={y} r="4.6" />)}
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
