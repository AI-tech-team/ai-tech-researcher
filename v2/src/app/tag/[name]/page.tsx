import type { Metadata } from 'next';
import { cache } from 'react';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { getArticlesByTag } from '@/app/actions';
import { ArticleListView } from '@/components/ArticleListView';
import { JsonLd } from '@/components/JsonLd';

const getTag = cache((t: string) => getArticlesByTag(t, 80));

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const articles = await getTag(decoded);
  if (articles.length === 0) return { title: `#${decoded}`, robots: { index: false, follow: true } };
  const desc = `「${decoded}」タグのAI・技術ニュース ${articles.length}件。${SITE_NAME} が自動収集・日本語要約。`;
  return {
    title: `#${decoded} のニュース`,
    description: desc,
    openGraph: { title: `#${decoded} のニュース`, description: desc, type: 'website', url: `/tag/${encodeURIComponent(decoded)}` },
    twitter: { card: 'summary_large_image', title: `#${decoded} のニュース`, description: desc },
  };
}

export default async function TagPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const articles = await getTag(decoded);
  const base = `${SITE_URL}/tag/${encodeURIComponent(decoded)}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: `#${decoded}`, item: base },
        ],
      },
      {
        '@type': 'ItemList',
        itemListElement: articles.slice(0, 20).map((a, i) => ({
          '@type': 'ListItem', position: i + 1, url: `${SITE_URL}/articles/${a.id}`, name: a.titleJa || a.title || '無題',
        })),
      },
    ],
  };
  return (
    <>
      <JsonLd data={jsonLd} />
      <ArticleListView kicker="Tag" title={`#${decoded}`} articles={articles} />
    </>
  );
}
