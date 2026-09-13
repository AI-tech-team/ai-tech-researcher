import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// 検索クローラ向け。公開ページは許可、APIはクロール不要なので除外。
//
// ⚠ 未公開のあいだも **Disallow にはしない**（2026-09-13）。クロールを止めると
//   クローラが noindex を読めなくなり、既にインデックスされたページが消えなくなるため。
//   「載せない」は allow + noindex（src/lib/site.ts の SITE_NOINDEX）で実現している。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
