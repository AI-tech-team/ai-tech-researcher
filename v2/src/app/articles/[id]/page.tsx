import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrainCircuit, ArrowLeft } from 'lucide-react';
import { SITE_NAME } from '@/lib/site';
import { getArticleById } from '@/app/actions';
import { ArticleView } from '@/components/ArticleView';

// 記事ごとの全画面ページ。共有/直リンク/検索インデックス向けに、サーバーで本文を取得してSSRする。
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const article = await getArticleById(Number(id));
  if (!article) return { title: '記事が見つかりません' };
  const title = article.titleJa || article.title || '無題';
  const description = article.summary ?? `${SITE_NAME} が収集・要約したAI・技術ニュース。`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'article', url: `/articles/${id}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await getArticleById(Number(id));
  if (!article) notFound();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#03060f]/85 border-b border-white/5">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-5 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <BrainCircuit className="text-white" size={15} />
            </div>
            <span className="font-bold text-sm font-outfit">{SITE_NAME}</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> トップ
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-3 sm:px-5 py-6 sm:py-8">
        <article className="rounded-2xl border border-white/10 bg-[#070b16]">
          <ArticleView article={article} />
        </article>
        <div className="mt-6">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> 一覧に戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
