"use client";

import { useEffect, useState } from 'react';
import { X, Newspaper } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getArticleById, type ArticleDetail } from '@/app/actions';
import { ArticleDetailContent } from '@/components/ArticleDetailContent';

interface Props {
  articleId: number | null;
  onClose: () => void;
  onToggleFavorite: (id: number, current: boolean) => void;
  onToggleReadLater: (id: number, current: boolean) => void;
  onMarkAsRead: (id: number, current: boolean) => void;
  onShowInList?: (id: number) => void;
}

// オーナー画面(HomeClient)で使う記事モーダル。公開UIは /articles/[id] の全画面ページへ移行済み。
export function ArticleDetailModal({
  articleId, onClose, onToggleFavorite, onToggleReadLater, onMarkAsRead, onShowInList,
}: Props) {
  // 取得結果は「どのidに対する結果か」を持たせ、loading/not-foundを区別（同期setStateを避けlintクリーン）
  const [result, setResult] = useState<{ id: number; article: ArticleDetail | null } | null>(null);

  useEffect(() => {
    if (articleId == null) return;
    let cancelled = false;
    getArticleById(articleId)
      .then(a => { if (!cancelled) setResult({ id: articleId, article: a }); })
      .catch(() => { if (!cancelled) setResult({ id: articleId, article: null }); });
    return () => { cancelled = true; };
  }, [articleId]);

  const loading = articleId != null && result?.id !== articleId;
  const article = result?.id === articleId ? result.article : null;

  // Escで閉じる
  useEffect(() => {
    if (articleId == null) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [articleId, onClose]);

  const open = articleId != null;
  const fav = !!article?.isFavorited;
  const rl = !!article?.isReadLater;
  const read = !!article?.isRead;

  const patch = (p: Partial<ArticleDetail>) =>
    setResult(r => (r && r.article ? { ...r, article: { ...r.article, ...p } } : r));
  const toggleFav = () => { if (!article) return; onToggleFavorite(article.id, fav); patch({ isFavorited: fav ? 0 : 1 }); };
  const toggleRl = () => { if (!article) return; onToggleReadLater(article.id, rl); patch({ isReadLater: rl ? 0 : 1 }); };
  const toggleRead = () => { if (!article) return; onMarkAsRead(article.id, read); patch({ isRead: read ? 0 : 1 }); };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-6"
        >
          <motion.div
            initial={{ y: 30, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full sm:max-w-2xl max-h-[88vh] sm:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#070b16] shadow-2xl"
          >
            {/* Close */}
            <button onClick={onClose}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/40 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <X size={18} />
            </button>

            {loading ? (
              <div className="flex items-center justify-center py-24 text-slate-500 text-sm">読み込み中...</div>
            ) : !article ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-500 text-sm gap-2">
                <Newspaper size={32} className="opacity-20" />
                記事が見つかりませんでした
              </div>
            ) : (
              <ArticleDetailContent
                article={article} fav={fav} rl={rl} read={read}
                onToggleFav={toggleFav} onToggleRl={toggleRl} onToggleRead={toggleRead}
                onShowInList={onShowInList ? () => onShowInList(article.id) : undefined}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
