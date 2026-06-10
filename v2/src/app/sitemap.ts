import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { getCollectedDataList, getReportsData } from '@/app/actions';

// 公開ページのサイトマップ。入口ページに加え、全画面ページの記事(/articles/[id])と
// レポート(/reports/[id])の直近分を列挙してクローラに知らせる（どちらも独立URLを持つ）。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
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

  let reportPages: MetadataRoute.Sitemap = [];
  try {
    const reports = await getReportsData(); // 公開対象(daily/weekly/monthly)のみ
    reportPages = reports.map(r => {
      const d = r.reportDate ? new Date(r.reportDate) : (r.createdAt ? new Date(r.createdAt) : now);
      return {
        url: `${SITE_URL}/reports/${r.id}`,
        lastModified: isNaN(d.getTime()) ? now : d,
        changeFrequency: 'monthly' as const,
        priority: 0.6, // 自前生成のレポートは記事より優先度を少し高く
      };
    });
  } catch {
    // 取得失敗時はレポートを除外（sitemap自体は落とさない）
  }

  return [...pages, ...reportPages, ...articles];
}
