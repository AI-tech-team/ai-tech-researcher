import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { getCollectedDataList, getReportsData, getSitemapTopics } from '@/app/actions';

// 記事のカテゴリ（固定セット）。/category/[name] ランディング用。
const CATEGORIES = ['LLM推論', 'エージェント', 'ツール/フレームワーク', 'ハードウェア', 'ビジネス応用', '研究/論文', 'その他'];

// 公開ページのサイトマップ。入口ページに加え、全画面ページの記事(/articles/[id])と
// レポート(/reports/[id])の直近分を列挙してクローラに知らせる（どちらも独立URLを持つ）。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/status`, lastModified: now, changeFrequency: 'daily', priority: 0.4 },
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

  // カテゴリのランディング（固定）
  const categoryPages: MetadataRoute.Sitemap = CATEGORIES.map(c => ({
    url: `${SITE_URL}/category/${encodeURIComponent(c)}`,
    lastModified: now, changeFrequency: 'daily' as const, priority: 0.5,
  }));

  // 知識グラフの主要トピック（関係を持つ＝中身のあるエンティティ）
  let topicPages: MetadataRoute.Sitemap = [];
  try {
    const topics = await getSitemapTopics(300);
    topicPages = topics.map(t => ({
      url: `${SITE_URL}/topic/${encodeURIComponent(t)}`,
      lastModified: now, changeFrequency: 'weekly' as const, priority: 0.5,
    }));
  } catch {
    // 取得失敗時はトピックを除外（sitemap自体は落とさない）
  }

  return [...pages, ...categoryPages, ...topicPages, ...reportPages, ...articles];
}
