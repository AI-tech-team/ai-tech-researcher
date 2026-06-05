"use client";

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { toggleFavorite, toggleReadLater, markAsRead, type ArticleDetail } from '@/app/actions';
import { ArticleDetailContent } from '@/components/ArticleDetailContent';

// /articles/[id] 全画面ページの本体。記事はサーバーで取得済み(article)を受け取る。
// お気に入り/後で読む/既読のトグルだけクライアントで扱い、未ログインならログインへ誘導する。
export function ArticleView({ article }: { article: ArticleDetail }) {
  const { data: session, status } = useSession();
  const uid = (session?.user as { id?: number } | undefined)?.id;
  const [fav, setFav] = useState(!!article.isFavorited);
  const [rl, setRl] = useState(!!article.isReadLater);
  const [read, setRead] = useState(!!article.isRead);

  const onToggleFav = async () => {
    if (status === 'loading') return; // セッション解決中は無視
    if (!uid) { signIn('google'); return; }
    const cur = fav;
    setFav(!cur); // 楽観更新（失敗時はロールバック）
    try { const r = await toggleFavorite(article.id, cur); if (!r?.success) setFav(cur); }
    catch { setFav(cur); }
  };
  const onToggleRl = async () => {
    if (status === 'loading') return;
    if (!uid) { signIn('google'); return; }
    const cur = rl;
    setRl(!cur);
    try { const r = await toggleReadLater(article.id, cur); if (!r?.success) setRl(cur); }
    catch { setRl(cur); }
  };
  const onToggleRead = async () => {
    if (status === 'loading') return;
    if (!uid) return; // 未ログインは静かに無視（閲覧は自由）
    const cur = read;
    setRead(!cur);
    try { const r = await markAsRead(article.id, cur); if (!r?.success) setRead(cur); }
    catch { setRead(cur); }
  };

  return (
    <ArticleDetailContent
      article={article} fav={fav} rl={rl} read={read}
      onToggleFav={onToggleFav} onToggleRl={onToggleRl} onToggleRead={onToggleRead}
    />
  );
}
