import type { Metadata } from 'next';
import { searchArticles } from '@/app/actions';
import { ArticleListView } from '@/components/ArticleListView';
import { SearchBox } from '@/components/SearchBox';

// 検索結果ページ（共有・履歴・JS無しでも動く）。クライアント専用の SearchPalette を補完する全画面版。
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string }> }): Promise<Metadata> {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  // 検索結果ページは noindex（薄い/無限ページのindexを避けるSEOの定石）。URL共有は可能。
  return { title: q ? `「${q}」の検索結果` : '検索', robots: { index: false, follow: true } };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const articles = q.length >= 2 ? await searchArticles(q) : [];
  return (
    <ArticleListView
      kicker="Search"
      title={q ? `「${q}」` : '検索'}
      articles={articles}
      topSlot={<SearchBox q={q} />}
      emptyText={q.length < 2 ? 'キーワードを入力してください（2文字以上）。' : `「${q}」に一致する記事は見つかりませんでした。`}
    />
  );
}
