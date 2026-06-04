import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// 公開ページのサイトマップ。記事/レポートはクエリパラメータ(?article=・?report=)で開く構成のため、
// 個別URLはOG付きで共有時に展開される。ここでは安定した入口ページのみを列挙する。
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
