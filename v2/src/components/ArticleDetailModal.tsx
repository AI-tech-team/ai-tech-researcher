"use client";

import { useEffect, useState } from 'react';
import { X, Star, Bookmark, CheckCircle2, ExternalLink, ListTree, Newspaper } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getArticleById, type ArticleDetail } from '@/app/actions';
import { safeHttpUrl } from '@/lib/safeUrl';

const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': '#38bdf8', 'エージェント': '#818cf8', 'ツール/フレームワーク': '#34d399',
  'ハードウェア': '#fb923c', 'ビジネス応用': '#f472b6', '研究/論文': '#a78bfa', 'その他': '#475569',
};

interface Props {
  articleId: number | null;
  onClose: () => void;
  onToggleFavorite: (id: number, current: boolean) => void;
  onToggleReadLater: (id: number, current: boolean) => void;
  onMarkAsRead: (id: number, current: boolean) => void;
  onShowInList?: (id: number) => void;
}

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
  const color = CATEGORY_COLORS[article?.category ?? ''] ?? '#475569';
  const safeUrl = safeHttpUrl(article?.url); // javascript:/data:等を弾いてから href に使う

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
              <div className="p-5 sm:p-6 space-y-4">
                {/* メタ */}
                <div className="flex items-center gap-2 flex-wrap pr-8">
                  <span className="font-mono text-[10px] font-bold tracking-widest uppercase" style={{ color }}>{article.category ?? 'OTHER'}</span>
                  <span className="font-mono text-[10px] px-1.5 py-px rounded border font-bold"
                    style={{ color: '#fb923c', borderColor: '#fb923c28', background: '#fb923c10' }}>★{article.importanceScore ?? 0}</span>
                  {(article.storyCount ?? 1) > 1 && (article.storyOutlets?.length ?? 0) > 0 && (
                    <span className="flex items-center gap-0.5 font-mono text-[10px] text-cyan-300 border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-px rounded">
                      <Newspaper size={10} />{article.storyOutlets!.slice(0, 3).join('・')}が報じた
                    </span>
                  )}
                  {read && (
                    <span className="flex items-center gap-0.5 font-mono text-[10px] text-emerald-500 border border-emerald-900/60 bg-emerald-950/50 px-1.5 py-px rounded">
                      <CheckCircle2 size={10} />READ
                    </span>
                  )}
                </div>

                {/* タイトル */}
                <div>
                  <h2 className="text-lg font-bold text-white leading-snug">{article.titleJa || article.title || '無題'}</h2>
                  {article.titleJa && article.title && article.titleJa !== article.title && (
                    <p className="text-xs text-slate-500 mt-1">{article.title}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 font-mono text-[10px] text-slate-600">
                    {article.sourceValue && <span style={{ color: `${color}90` }}>{article.sourceValue}</span>}
                    {article.publishedAt && <><span>·</span><span>{new Date(article.publishedAt).toLocaleDateString('ja-JP')}</span></>}
                  </div>
                </div>

                {/* アクション */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={toggleFav}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${fav ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}>
                    <Star size={13} className={fav ? 'fill-amber-400' : ''} /> お気に入り
                  </button>
                  <button onClick={toggleRl}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${rl ? 'border-sky-500/30 bg-sky-500/10 text-sky-400' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}>
                    <Bookmark size={13} className={rl ? 'fill-sky-400' : ''} /> 後で読む
                  </button>
                  <button onClick={toggleRead}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${read ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}>
                    <CheckCircle2 size={13} /> {read ? '既読' : '既読にする'}
                  </button>
                  {safeUrl && (
                    <a href={safeUrl} target="_blank" rel="noopener noreferrer"
                      onClick={() => { if (!read) toggleRead(); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 text-xs font-bold transition-colors">
                      <ExternalLink size={13} /> 元記事
                    </a>
                  )}
                  {onShowInList && (
                    <button onClick={() => onShowInList(article.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 text-xs font-bold transition-colors">
                      <ListTree size={13} /> 一覧で表示
                    </button>
                  )}
                </div>

                {/* サマリー */}
                {article.summary && (
                  <p className="text-sm text-slate-300 leading-relaxed border-l-2 border-sky-500/30 pl-3">{article.summary}</p>
                )}

                {/* 本文（抽出済みがあれば） */}
                {article.rawContent && (
                  <div>
                    <p className="font-mono text-[10px] text-slate-600 uppercase tracking-widest mb-1.5">本文（抽出）</p>
                    <p className="text-[13px] text-slate-400 leading-relaxed whitespace-pre-wrap">{article.rawContent.slice(0, 6000)}</p>
                  </div>
                )}

                {/* タグ */}
                {article.tags && article.tags.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] text-slate-600 pt-1">
                    {article.tags.slice(0, 6).map(t => <span key={t}>#{t}</span>)}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
