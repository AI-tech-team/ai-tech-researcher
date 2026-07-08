import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { Providers } from "@/components/Providers";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { BackToTop } from "@/components/BackToTop";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL, SITE_NAME, SITE_DESC } from "@/lib/site";

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
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

// スプラッシュのセッションゲート（静的定数・外部入力なし）。sessionStorage不可(プライベートモード等)でも
// catchで握って毎回表示にフォールバックするだけ＝閉じ込めは起きない。
const SPLASH_SESSION_GATE_JS =
  "try{if(sessionStorage.getItem('kt_splash')){document.getElementById('kt-splash').style.display='none'}else{sessionStorage.setItem('kt_splash','1')}}catch(e){}";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — 毎日「育つ」AIリサーチ`, template: `%s — ${SITE_NAME}` },
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
    <html lang="ja" className={`${inter.variable} ${outfit.variable} h-full antialiased`}>
      <body className="min-h-full">
        {/* アクセシビリティ: キーボード/スクリーンリーダー向けのスキップリンク（Tabで最初に当たる） */}
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-sky-600 focus:text-white focus:text-sm focus:font-bold">
          メインコンテンツへスキップ
        </a>
        {/* 起動スプラッシュ「新芽が育つ」: サーバー描画＋CSSのみで完結（Reactハイドレーションに依存しない）。
            旧実装はJSタイマー＋visibility付きCSSで消していたが、どちらもメインスレッド依存のため
            ハイドレーション中(数秒)はアニメが凍って居座った。opacityのみのフェード（コンポジタ駆動）に変更。
            直後のインラインscriptで「同一セッション2回目以降は出さない」(sessionStorage)。 */}
        <div aria-hidden id="kt-splash" className="splash">
          <svg width="132" height="145" viewBox="0 0 100 110">
            <circle className="splash__bglow" cx="50" cy="44" r="30" fill="#22d3ee" opacity="0.2" />
            <g className="splash__bulb">
              <circle cx="50" cy="44" r="26" fill="#0a1326" stroke="#38bdf8" strokeWidth="3.4" />
              <path d="M40 66 L41.5 80 L58.5 80 L60 66 Z" fill="#0a1326" stroke="#38bdf8" strokeWidth="3.4" strokeLinejoin="round" />
              <line x1="43" y1="85" x2="57" y2="85" stroke="#64748b" strokeWidth="2.6" strokeLinecap="round" />
              <line x1="44" y1="90" x2="56" y2="90" stroke="#64748b" strokeWidth="2.6" strokeLinecap="round" />
              <line x1="45" y1="95" x2="55" y2="95" stroke="#64748b" strokeWidth="2.6" strokeLinecap="round" />
            </g>
            <rect className="splash__stem" x="48.4" y="44" width="3.2" height="22" rx="1.6" fill="#34d399" />
            <path className="splash__leafL" d="M50 54 C44 50 37 47 32 49 C35 54 43 55 50 54 Z" fill="#34d399" />
            <path className="splash__leafR" d="M50 50 C56 46 63 43 68 45 C65 50 57 51 50 50 Z" fill="#5fe6ab" />
            <circle className="splash__seed" cx="50" cy="44" r="2.2" fill="#eafff5" />
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
