import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// 検索クローラ向け。公開ページは許可、APIはクロール不要なので除外。
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
