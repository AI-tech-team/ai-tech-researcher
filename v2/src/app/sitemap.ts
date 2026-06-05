import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { getCollectedDataList } from '@/app/actions';

// 公開ページのサイトマップ。入口ページに加え、全画面記事ページ(/articles/[id])の直近分を列挙する。
// レポートは ?report= で開くモーダルのため個別URLを持たないが、記事は独立ページなのでクローラに知らせる。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/changelog`, lastModified: now, changeFrequency: 'weekly', priority: 0.4 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  let articles: MetadataRoute.Sitemap = [];
  try {
    const items = await getCollectedDataList(200, 0);
    articles = items.map(i => {
      const d = i.publishedAt ? new Date(i.publishedAt) : now;
      return {
        url: `${SITE_URL}/articles/${i.id}`,
        lastModified: isNaN(d.getTime()) ? now : d,
        changeFrequency: 'monthly' as const,
        priority: 0.5,
      };
    });
  } catch {
    // 取得失敗時は入口ページのみ返す（sitemap自体を落とさない）
  }

  return [...pages, ...articles];
}
