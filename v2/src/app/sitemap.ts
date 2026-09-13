import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { getSitemapArticles, getReportsData, getSitemapTopics } from '@/app/actions';

// 記事のカテゴリ（固定セット）。/category/[name] ランディング用。
const CATEGORIES = ['LLM推論', 'エージェント', 'ツール/フレームワーク', 'ハードウェア', 'ビジネス応用', '研究/論文', 'その他'];

// 公開ページのサイトマップ。入口ページに加え、全画面ページの記事(/articles/[id])と
// レポート(/reports/[id])の直近分を列挙してクローラに知らせる（どちらも独立URLを持つ）。
// 本番実測で /sitemap.xml の生成に46.8秒かかっていた（Googlebotは待たない＝実質クロール不能）。
// 生成自体の内訳測定は本番読み取りトークンの失効で未実施だが、1時間キャッシュすれば
// 配信は常にCDNからになり、クローラが46秒待たされることは無くなる。内訳の是正は別途。
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/topic`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${SITE_URL}/changelog`, lastModified: now, changeFrequency: 'weekly', priority: 0.4 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  let articles: MetadataRoute.Sitemap = [];
  try {
    // ⚠ 上限は「何日分か」で考える。旧実装の200件は流入221件/日を下回り、**1日未満**しか載らなかった。
    // 2026-09-13 本人の判断で**全件**に。約22,000URL＝Googleの上限(1ファイル50,000URL/50MB)の内側。
    // cookies を読まない専用クエリなので sitemap は静的のまま（revalidate=3600 が効く）。
    const items = await getSitemapArticles();
    articles = items.map(i => {
      const d = i.date ? new Date(i.date) : now;
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
    const reports = await getReportsData(1000, 1); // 公開対象のみ。URL列挙用なので本文は取らない
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
