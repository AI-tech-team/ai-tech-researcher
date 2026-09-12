import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { SITE_NAME } from '@/lib/site';
import { BrandNav, BrandFooter } from '@/components/digest/BrandChrome';
import s from '@/styles/brand.module.css';
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
    // 版面は読者のテーマに従う（黒地固定の `s.page` は朝刊のヒーロー用）。
    // 記事は読み物なので、/articles と同じ地の色に乗せる。
    <div className="min-h-screen">
      <BrandNav />
      <main id="main-content" style={{ paddingTop: 8 }}>
        <ArticleView article={article} />
        <div className={`${s.artShell} ${s.artBack}`}>
          <Link href="/articles" className={s.artBtn} style={{ padding: 0 }}>
            <ArrowLeft size={13} /> 記事一覧に戻る
          </Link>
        </div>
      </main>
      <BrandFooter />
    </div>
  );
}
