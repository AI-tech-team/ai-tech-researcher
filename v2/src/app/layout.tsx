import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { Providers } from "@/components/Providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ai-tech-researcher.vercel.app';
const SITE_NAME = 'AI Tech Researcher';
const SITE_DESC = '毎日「育つ」AIリサーチ — 最新動向を自動で集め、要約・分析・知識グラフ化してお届けします。';

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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${inter.variable} ${outfit.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>
          <ToastProvider>{children}</ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
