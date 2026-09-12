import type { Metadata } from 'next';
import { cache } from 'react';
import { SITE_NAME, SITE_URL, RSS_ALTERNATE_TYPES } from '@/lib/site';
import { getArticlesByTag } from '@/app/actions';
import { ArticleListView } from '@/components/ArticleListView';
import { Pagination } from '@/components/Pagination';
import { JsonLd } from '@/components/JsonLd';

const PAGE_SIZE = 40;
const getTag = cache((t: string, offset: number) => getArticlesByTag(t, PAGE_SIZE, offset));

function pageNum(sp: { page?: string }): number {
  return Math.max(1, Math.floor(Number(sp.page)) || 1);
}

export async function generateMetadata(
  { params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<{ page?: string }> },
): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const page = pageNum(await searchParams);
  const articles = await getTag(decoded, (page - 1) * PAGE_SIZE);
  const path = `/tag/${encodeURIComponent(decoded)}`;
  // /category と同じ扱い。canonical は各ページ自身を指す（理由は category/[name]/page.tsx のコメント）。
  if (articles.length === 0 || page > 1) {
    return {
      title: page > 1 ? `#${decoded}（${page}ページ）` : `#${decoded}`,
      alternates: { canonical: page > 1 ? `${path}?page=${page}` : path, types: RSS_ALTERNATE_TYPES },
      robots: { index: false, follow: true },
    };
  }
  const desc = `「${decoded}」タグのAI・技術ニュース。${SITE_NAME} が自動収集・日本語要約。`;
  return {
    title: `#${decoded} のニュース`,
    description: desc,
    alternates: { canonical: path, types: RSS_ALTERNATE_TYPES },
    openGraph: { title: `#${decoded} のニュース`, description: desc, type: 'website', url: `/tag/${encodeURIComponent(decoded)}` },
    twitter: { card: 'summary_large_image', title: `#${decoded} のニュース`, description: desc },
  };
}

export default async function TagPage(
  { params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<{ page?: string }> },
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const page = pageNum(await searchParams);
  const offset = (page - 1) * PAGE_SIZE;
  const articles = await getTag(decoded, offset);
  const base = `/tag/${encodeURIComponent(decoded)}`;
  const siteBase = `${SITE_URL}/tag/${encodeURIComponent(decoded)}`;

  const prevHref = page > 1 ? (page === 2 ? base : `${base}?page=${page - 1}`) : null;
  const nextHref = articles.length === PAGE_SIZE ? `${base}?page=${page + 1}` : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: `#${decoded}`, item: siteBase },
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
        kicker={page > 1 ? `Tag · ${page}ページ目` : 'Tag'}
        title={`#${decoded}`}
        articles={articles}
        paginationSlot={<Pagination prevHref={prevHref} nextHref={nextHref} page={page} />}
      />
    </>
  );
}
