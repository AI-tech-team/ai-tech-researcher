"use client";

import { useEffect, useState } from 'react';
import { X, Bookmark, Star, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getMyReadLater, getMyFavorites } from '@/app/actions';
import type { CollectedItem } from '@/types';

const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': '#38bdf8', 'エージェント': '#818cf8', 'ツール/フレームワーク': '#34d399',
  'ハードウェア': '#fb923c', 'ビジネス応用': '#f472b6', '研究/論文': '#a78bfa', 'その他': '#475569',
};

type Tab = 'readlater' | 'favorites';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenArticle: (id: number) => void;
  onToggleReadLater: (id: number, current: boolean) => Promise<void> | void;
  onToggleFavorite: (id: number, current: boolean) => Promise<void> | void;
}

// 公開UI: ログインユーザーの「後で読む」「お気に入り」の全件ビュー
export function SavedItemsModal({ open, onClose, onOpenArticle, onToggleReadLater, onToggleFavorite }: Props) {
  const [tab, setTab] = useState<Tab>('readlater');
  const [readLater, setReadLater] = useState<CollectedItem[]>([]);
  const [favorites, setFavorites] = useState<CollectedItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    Promise.all([getMyReadLater(), getMyFavorites()])
      .then(([rl, fav]) => {
        if (cancelled) return;
        setReadLater(rl as CollectedItem[]);
        setFavorites(fav as CollectedItem[]);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const pickArticle = (id: number) => { onOpenArticle(id); onClose(); };

  const removeReadLater = async (id: number) => {
    setReadLater(prev => prev.filter(i => i.id !== id));
    await onToggleReadLater(id, true);
  };
  const removeFavorite = async (id: number) => {
    setFavorites(prev => prev.filter(i => i.id !== id));
    await onToggleFavorite(id, true);
  };

  const items = tab === 'readlater' ? readLater : favorites;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-[65] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-6"
        >
          <motion.div
            initial={{ y: 30, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full sm:max-w-xl max-h-[90vh] sm:max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#070b16] shadow-2xl overflow-hidden"
          >
            <button onClick={onClose}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/40 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <X size={18} />
            </button>

            <div className="px-5 pt-5 pb-3 border-b border-white/5">
              <h2 className="text-base font-bold text-white mb-3">保存した記事</h2>
              <div className="flex gap-1.5">
                <button onClick={() => setTab('readlater')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${tab === 'readlater' ? 'bg-sky-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>
                  <Bookmark size={12} /> 後で読む {readLater.length > 0 && <span className="font-mono opacity-70">({readLater.length})</span>}
                </button>
                <button onClick={() => setTab('favorites')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${tab === 'favorites' ? 'bg-sky-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>
                  <Star size={12} /> お気に入り {favorites.length > 0 && <span className="font-mono opacity-70">({favorites.length})</span>}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <p className="px-5 py-10 text-center text-xs text-slate-600">読み込み中…</p>
              ) : items.length === 0 ? (
                <div className="px-5 py-12 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
                  {tab === 'readlater'
                    ? <><Bookmark size={28} className="opacity-20" /><p>「後で読む」に保存した記事はまだありません。</p></>
                    : <><Star size={28} className="opacity-20" /><p>お気に入りに登録した記事はまだありません。</p></>}
                </div>
              ) : (
                <div className="py-1">
                  {items.map(item => {
                    const color = CATEGORY_COLORS[item.category ?? ''] ?? '#475569';
                    const title = item.titleJa || item.title || '無題';
                    return (
                      <div key={item.id}
                        className="px-5 py-3 hover:bg-white/[0.03] transition-colors border-b border-white/[0.03] last:border-0 flex items-start gap-3">
                        <button onClick={() => pickArticle(item.id)} className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-[9px] font-bold tracking-widest uppercase flex-shrink-0" style={{ color }}>
                              {item.category ?? 'OTHER'}
                            </span>
                          </div>
                          <p className="text-sm text-slate-100 font-medium leading-snug">{title}</p>
                          {item.summary && <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{item.summary}</p>}
                        </button>
                        <button
                          onClick={() => tab === 'readlater' ? removeReadLater(item.id) : removeFavorite(item.id)}
                          title={tab === 'readlater' ? '「後で読む」から外す' : 'お気に入りから外す'}
                          className="p-1.5 rounded-md hover:bg-red-500/10 text-slate-600 hover:text-red-400 transition-colors flex-shrink-0">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
