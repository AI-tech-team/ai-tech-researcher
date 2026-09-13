import type { NextConfig } from "next";
import { SITE_NOINDEX } from "./src/lib/site";

// セキュリティヘッダ（多層防御）。全ルートに付与する。
// CSPはNext.js/framer-motion/recharts/Googleログイン/next-imageを壊さない範囲に留める
// （script/styleの 'unsafe-inline' はNextのハイドレーション/インラインstyleに必要。
//  XSS自体はReactの自動エスケープ＋dangerouslySetInnerHTML不使用で抑止済みのため、
//  ここでのCSPは frame-ancestors/object-src/base-uri 等の追加防御が主目的）。
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "worker-src 'self'",                                  // Service Worker(/sw.js)を許可

  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https:",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },                         // クリックジャッキング防止
  { key: 'X-Content-Type-Options', value: 'nosniff' },               // MIMEスニッフ防止
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }, // HTTPS強制(preloadは付けない=可逆)
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

// 未公開のあいだは全レスポンスに noindex を付ける（ページのmetadataより確実で、
// sitemap.xml や feed.xml のような非HTMLにも効く）。公開時は src/lib/site.ts の SITE_NOINDEX を false に。
const noindexHeaders = SITE_NOINDEX
  ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]
  : [];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: [...securityHeaders, ...noindexHeaders] }];
  },
};

export default nextConfig;
