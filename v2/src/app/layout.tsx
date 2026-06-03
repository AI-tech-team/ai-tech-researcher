import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { Providers } from "@/components/Providers";
import { SITE_URL, SITE_NAME, SITE_DESC } from "@/lib/site";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

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
        {/* Cookieレス・匿名のアクセス解析（PIIを集めない方針と両立）。Vercel側でWeb Analytics有効化が必要 */}
        <Analytics />
      </body>
    </html>
  );
}
