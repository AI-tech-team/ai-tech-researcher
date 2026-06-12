import type { Metadata } from 'next';
import { cache } from 'react';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { getArticlesByCategory } from '@/app/actions';
import { ArticleListView } from '@/components/ArticleListView';
import { Pagination } from '@/components/Pagination';
import { JsonLd } from '@/components/JsonLd';

const PAGE_SIZE = 40;
const getCat = cache((c: string, offset: number) => getArticlesByCategory(c, PAGE_SIZE, offset));

function pageNum(sp: { page?: string }): number {
  return Math.max(1, Math.floor(Number(sp.page)) || 1);
}

export async function generateMetadata(
  { params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<{ page?: string }> },
): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const page = pageNum(await searchParams);
  const articles = await getCat(decoded, (page - 1) * PAGE_SIZE);
  // 空 or 2ページ目以降は noindex（薄い/重複ページの量産を防ぐ）
  if (articles.length === 0 || page > 1) return { title: page > 1 ? `${decoded}（${page}ページ）` : decoded, robots: { index: false, follow: true } };
  const desc = `「${decoded}」カテゴリのAI・技術ニュース。${SITE_NAME} が自動収集・日本語要約。`;
  return {
    title: `${decoded} のニュース`,
    description: desc,
    openGraph: { title: `${decoded} のニュース`, description: desc, type: 'website', url: `/category/${encodeURIComponent(decoded)}` },
    twitter: { card: 'summary_large_image', title: `${decoded} のニュース`, description: desc },
  };
}

export default async function CategoryPage(
  { params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<{ page?: string }> },
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const page = pageNum(await searchParams);
  const offset = (page - 1) * PAGE_SIZE;
  const articles = await getCat(decoded, offset);
  const base = `/category/${encodeURIComponent(decoded)}`;
  const siteBase = `${SITE_URL}/category/${encodeURIComponent(decoded)}`;

  const prevHref = page > 1 ? (page === 2 ? base : `${base}?page=${page - 1}`) : null;
  const nextHref = articles.length === PAGE_SIZE ? `${base}?page=${page + 1}` : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: decoded, item: siteBase },
      ] },
      { '@type': 'ItemList', itemListElement: articles.slice(0, 20).map((a, i) => ({
        '@type': 'ListItem', position: i + 1, url: `${SITE_URL}/articles/${a.id}`, name: a.titleJa || a.title || '無題',
      })) },
    ],
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      <ArticleListView
        kicker={page > 1 ? `Category · ${page}ページ目` : 'Category'}
        title={decoded}
        articles={articles}
        paginationSlot={<Pagination prevHref={prevHref} nextHref={nextHref} page={page} />}
      />
    </>
  );
}
