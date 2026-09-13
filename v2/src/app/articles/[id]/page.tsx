import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { SITE_NAME, SITE_URL, RSS_ALTERNATE_TYPES } from '@/lib/site';
import { BrandNav, BrandFooter } from '@/components/digest/BrandChrome';
import s from '@/styles/brand.module.css';
import { getArticleById } from '@/app/actions';
import { ArticleView } from '@/components/ArticleView';
import { JsonLd } from '@/components/JsonLd';
import { safeHttpUrl } from '@/lib/safeUrl';

// generateMetadata と本体で2回呼ばれるので、リクエスト内でキャッシュして往復を1回にする。
// 第2引数 true = 匿名取得。これが無いと currentUserId()→auth()→cookies() を読んでしまい、
// 下の revalidate が無効化される（= ISRに乗らない。理由は revalidate のコメント）。
const getArticle = cache((id: number) => getArticleById(id, true));

// 記事ごとの全画面ページ。共有/直リンク/検索インデックス向けに、サーバーで本文を取得してSSRする。
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const article = await getArticle(Number(id));
  if (!article) return { title: '記事が見つかりません' };
  const title = article.titleJa || article.title || '無題';
  const description = article.summary ?? `${SITE_NAME} が選り分けたAI・技術ニュース。`;
  return {
    title,
    description,
    // canonical が無いと、同じ記事に付く追跡クエリ（?utm_source=… 等）が全部別URL扱いになる。
    // 記事詳細は本紙で一番数の多い面なので、ここの取りこぼしが一番効く（2026-09-12 監査で18/19ページ欠落）。
    alternates: { canonical: `/articles/${article.id}`, types: RSS_ALTERNATE_TYPES },
    openGraph: { title, description, type: 'article', url: `/articles/${id}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

// ISR。/reports/[id] と同じ理由で、両方（generateStaticParams と revalidate）が要る。
// 2026-09-12 の本番実測: 記事詳細30本は x-vercel-cache = MISS 30/30・`private, no-store` で
// CDNに1本も乗っていなかった（中央値166ms / p90 395ms）。同じ条件のレポートは HIT 30/30・130ms。
// 空配列＝ビルド時は事前生成しない。動的セグメントは generateStaticParams が無いと
// ISRの対象にならず毎回オンデマンド実行になるため、空でも宣言してキャッシュに乗せる
// （未知のidは dynamicParams のデフォルト true で初回生成→以後キャッシュ。実在しないidは
//  middleware.ts がストリーミング前に404を確定させるのでここまで来ない）。
//
// ⚠ 日本語を含むパスのルート（/topic/[name]・/category/[name]）には**絶対に足さないこと**。
//   Next はキャッシュ可能ルートの `x-next-cache-tags` ヘッダにデコード済みpathnameをそのまま入れるが、
//   HTTPヘッダは Latin-1 までなので日本語や U+2011 が入ると 500 になる（2026-09-12 本番事故）。
//   数値idの /articles/[id] は ASCII なので安全。
export async function generateStaticParams() { return []; }

// 記事の中身（AI要約・要点）は生成後ほとんど変わらないので長めに持つ。
export const revalidate = 3600;

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await getArticle(Number(id));
  if (!article) notFound();

  // このページを Article として構造化する。
  // ⚠ 主張しているのは「元記事」ではなく**この解説ページ**。見出し・要約・要点はこちらの著作物で、
  //   元記事そのものは第三者著作なので本文を載せていない（第三条）。元記事は `isBasedOn` で参照するだけに留める。
  //   /reports/[id] は自前生成の号なので同じ Article だが、あちらは isBasedOn を持たない。
  const safeSource = safeHttpUrl(article.url);
  const published = article.publishedAt ? new Date(article.publishedAt) : null;
  const publishedIso = published && Number.isFinite(published.getTime()) ? published.toISOString() : null;
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: (article.titleJa || article.title || '無題').slice(0, 110), // schema.org の推奨上限
    ...(publishedIso ? { datePublished: publishedIso, dateModified: publishedIso } : {}),
    ...(article.summary ? { description: article.summary } : {}),
    ...(safeSource ? { isBasedOn: safeSource } : {}),
    inLanguage: 'ja',
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png` } },
    image: `${SITE_URL}/icon-512.png`,
    mainEntityOfPage: `${SITE_URL}/articles/${article.id}`,
  };

  return (
    // 版面は読者のテーマに従う（黒地固定の `s.page` は朝刊のヒーロー用）。
    // 記事は読み物なので、/articles と同じ地の色に乗せる。
    <div className="min-h-screen">
      <JsonLd data={articleJsonLd} />
      <BrandNav />
      <main id="main-content" style={{ paddingTop: 8 }}>
        {/* syncUserState: SSRを匿名化した分、ログイン中の状態は描画後にクライアントが引き直す */}
        <ArticleView article={article} syncUserState />
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
