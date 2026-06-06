import { notFound } from 'next/navigation';
import { getArticleById } from '@/app/actions';
import { ArticleView } from '@/components/ArticleView';
import { ModalShell } from '@/components/ModalShell';

// 一覧から /articles/[id] へソフト遷移したときだけ発火するインターセプト。
// 記事を全画面オーバーレイで表示し、裏のトップ(一覧)は保持＝戻っても再読み込みしない。
// 直リンク/リロード/共有では発火せず ../../../articles/[id]/page.tsx（独立ページ）が表示される。
export default async function ArticleModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await getArticleById(Number(id));
  if (!article) notFound();

  return (
    <ModalShell>
      <ArticleView article={article} />
    </ModalShell>
  );
}
