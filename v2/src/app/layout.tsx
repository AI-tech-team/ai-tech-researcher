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

// 起動スプラッシュ「流れから、一筋を抜く」。
//
// 図形は**点を使わず**、1本の曲線だけで作る（2026-09-12 方針変更）。
// 同じ経路を太さ違いで4本重ね、太く淡い3本＝毎日流れてくる記事の量、
// 細く明るい1本＝そこから抜き出した今朝の筋。厚みの差がそのまま「次元」になる。
// 旧版は7×4の点のうち5点を灯す「選別」だったが、点は粒に見えて流れにならなかった。
const SPLASH_FLOW = 'M2,60 C28,60 34,30 60,30 C86,30 92,62 118,62 C144,62 150,32 178,32';
/** 太さと濃さの層。左から奥→手前。手前の1本だけが夜明けの色で明るい。 */
const SPLASH_LAYERS: { w: number; o: number }[] = [
  { w: 30, o: 0.10 },
  { w: 18, o: 0.18 },
  { w: 9, o: 0.34 },
];

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
        {/* 起動スプラッシュ「流れから、一筋を抜く」: 1本の曲線を太さ違いで重ねる（点は使わない）。
            サーバー描画＋CSSのみで完結（Reactハイドレーションに依存しない）。
            旧実装はJSタイマー＋visibility付きCSSで消していたが、どちらもメインスレッド依存のため
            ハイドレーション中(数秒)はアニメが凍って居座った。opacityのみのフェード（コンポジタ駆動）に変更。
            直後のインラインscriptで「同一セッション2回目以降は出さない」(sessionStorage)。 */}
        <div aria-hidden id="cv-splash" className="splash">
          {/* ⚠ viewBox は太い線のはみ出しぶん（最大30の半分＝15）を外に取る。
                0 0 180 92 のままだと、いちばん太い層の左右がSVGの箱で**垂直に切れて**
                流れが壁にぶつかったように見えた（スマホ実機で発覚）。 */}
          <svg width="324" height="176" viewBox="-18 -10 216 112" fill="none">
            <defs>
              {/* 夜明け（藍→水色→淡金）。userSpaceOnUse なので、1本の筋の中で空の色が移り変わる。 */}
              <linearGradient id="cvDawn" gradientUnits="userSpaceOnUse" x1="0" y1="92" x2="180" y2="0">
                <stop offset="0%" stopColor="#a5b4fc" />
                <stop offset="38%" stopColor="#38bdf8" />
                <stop offset="88%" stopColor="#fde68a" />
              </linearGradient>
              <radialGradient id="cvGlow">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.42" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse className="splash__glow" cx="90" cy="46" rx="98" ry="46" fill="url(#cvGlow)" />
            {/* 流れ（奥の3本）。太く淡いほど奥。 */}
            <g className="splash__flow">
              {SPLASH_LAYERS.map(l => (
                <path key={l.w} d={SPLASH_FLOW} stroke="url(#cvDawn)" strokeOpacity={l.o}
                  strokeWidth={l.w} strokeLinecap="round" />
              ))}
            </g>
            {/* 抜き出した一筋（手前）。最後に、わずかに遅れて通る。 */}
            <path className="splash__pick" d={SPLASH_FLOW} stroke="url(#cvDawn)"
              strokeWidth="3.4" strokeLinecap="round" />
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
