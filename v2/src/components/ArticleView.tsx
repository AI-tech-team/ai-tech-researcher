"use client";

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { toggleFavorite, toggleReadLater, markAsRead, getMyArticleFlags, type ArticleDetail } from '@/app/actions';
import { ArticleDetailContent } from '@/components/ArticleDetailContent';

// /articles/[id] 全画面ページの本体。記事はサーバーで取得済み(article)を受け取る。
// お気に入り/後で読む/既読のトグルだけクライアントで扱い、未ログインならログインへ誘導する。
//
// `syncUserState` は「サーバー側が匿名で取得した＝articleにユーザー状態が入っていない」合図。
// 全画面ページはISR（CDN配信）のためSSRを匿名化してあるので true、
// モーダル（インターセプト）は動的でユーザー状態込みなので渡さない＝余計な往復をしない。
export function ArticleView({ article, syncUserState = false }: { article: ArticleDetail; syncUserState?: boolean }) {
  const { data: session, status } = useSession();
  const uid = (session?.user as { id?: number } | undefined)?.id;
  const [fav, setFav] = useState(!!article.isFavorited);
  const [rl, setRl] = useState(!!article.isReadLater);
  const [read, setRead] = useState(!!article.isRead);

  // ログイン中だけ、描画後に自分の状態へ補正する。これが無いと保存済みの記事で
  // ★が消灯したまま出て、押すと保存ではなく**解除**になる。
  useEffect(() => {
    if (!syncUserState || !uid) return;
    let cancelled = false;
    getMyArticleFlags(article.id)
      .then(f => {
        if (cancelled || !f) return;
        setFav(f.fav); setRl(f.rl); setRead(f.read);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [syncUserState, uid, article.id]);

  // トグルの確定値はサーバが決める（フロントは信用しない・行動原則6）。楽観更新→サーバ値で補正
  const onToggleFav = async () => {
    if (status === 'loading') return; // セッション解決中は無視
    if (!uid) { signIn('google'); return; }
    const cur = fav;
    setFav(!cur); // 楽観更新（失敗時はロールバック）
    try { const r = await toggleFavorite(article.id); if (!r?.success) setFav(cur); else if (typeof r.value === 'boolean') setFav(r.value); }
    catch { setFav(cur); }
  };
  const onToggleRl = async () => {
    if (status === 'loading') return;
    if (!uid) { signIn('google'); return; }
    const cur = rl;
    setRl(!cur);
    try { const r = await toggleReadLater(article.id); if (!r?.success) setRl(cur); else if (typeof r.value === 'boolean') setRl(r.value); }
    catch { setRl(cur); }
  };
  const onToggleRead = async () => {
    if (status === 'loading') return;
    if (!uid) return; // 未ログインは静かに無視（閲覧は自由）
    const cur = read;
    setRead(!cur);
    try { const r = await markAsRead(article.id); if (!r?.success) setRead(cur); else if (typeof r.value === 'boolean') setRead(r.value); }
    catch { setRead(cur); }
  };

  return (
    <ArticleDetailContent
      article={article} fav={fav} rl={rl} read={read}
      onToggleFav={onToggleFav} onToggleRl={onToggleRl} onToggleRead={onToggleRead}
    />
  );
}
