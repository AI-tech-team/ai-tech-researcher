import type { Metadata } from 'next';
import HomeClient from './HomeClient';
import { getArticleById, getReportById } from './actions';
import { SITE_URL, SITE_NAME } from '@/lib/site';

// シェア時のOG/Twitterカードを動的生成。?article=N または ?report=N が付いていれば
// その記事/レポートのタイトル・サマリーで上書きする。LLM追加コストなし（DB参照のみ）。
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ article?: string; report?: string }> },
): Promise<Metadata> {
  const sp = await searchParams;
  const articleId = sp.article ? Number(sp.article) : NaN;
  const reportId = sp.report ? Number(sp.report) : NaN;

  if (Number.isFinite(articleId)) {
    const a = await getArticleById(articleId).catch(() => null);
    if (a) {
      const title = (a.titleJa || a.title || '無題').slice(0, 80);
      const desc = (a.summary ?? '').slice(0, 200);
      const url = `${SITE_URL}/?article=${articleId}`;
      return {
        title,
        description: desc,
        openGraph: { title, description: desc, url, siteName: SITE_NAME, type: 'article', locale: 'ja_JP' },
        twitter: { card: 'summary_large_image', title, description: desc },
      };
    }
  }

  if (Number.isFinite(reportId)) {
    const r = await getReportById(reportId).catch(() => null);
    if (r) {
      const typeLabel = r.type === 'weekly' ? '週次レポート' : r.type === 'monthly' ? '月次レポート' : 'デイリーレポート';
      const title = `${typeLabel} ${r.reportDate}`;
      const lead = (r.content ?? '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[#*_`>]/g, '')
        .replace(/\[ID:\d+\]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      const url = `${SITE_URL}/?report=${reportId}`;
      return {
        title,
        description: lead,
        openGraph: { title, description: lead, url, siteName: SITE_NAME, type: 'article', locale: 'ja_JP' },
        twitter: { card: 'summary_large_image', title, description: lead },
      };
    }
  }

  // デフォルトは layout.tsx の site-wide metadata を継承
  return {};
}

export default function Page() {
  return <HomeClient />;
}
