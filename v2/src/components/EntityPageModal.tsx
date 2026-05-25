"use client";

import { useEffect, useState } from 'react';
import { X, Trophy, Network, Sparkles, ArrowRight, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getEntityKnowledgePage, type EntityPage } from '@/app/actions';

const RELATION_LABEL: Record<string, string> = {
  outperforms: '性能で上回る', supersedes: '置き換え', competes_with: '競合',
  builds_on: '基づく', acquired_by: '買収', cites: '引用',
};

interface Props {
  entityName: string | null;
  onClose: () => void;
  onOpenArticle?: (id: number) => void;
  onOpenEntity?: (name: string) => void;
}

export function EntityPageModal({ entityName, onClose, onOpenArticle, onOpenEntity }: Props) {
  const [result, setResult] = useState<{ name: string; page: EntityPage | null } | null>(null);

  useEffect(() => {
    if (entityName == null) return;
    let cancelled = false;
    getEntityKnowledgePage(entityName)
      .then(p => { if (!cancelled) setResult({ name: entityName, page: p }); })
      .catch(() => { if (!cancelled) setResult({ name: entityName, page: null }); });
    return () => { cancelled = true; };
  }, [entityName]);

  useEffect(() => {
    if (entityName == null) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [entityName, onClose]);

  const open = entityName != null;
  const loading = entityName != null && result?.name !== entityName;
  const page = result?.name === entityName ? result.page : null;
  const empty = page && page.benchmarks.length === 0 && page.relations.length === 0 && page.claims.length === 0 && page.articles.length === 0;

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
            className="relative w-full sm:max-w-2xl max-h-[88vh] sm:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-cyan-500/20 bg-[#070b16] shadow-2xl"
          >
            <button onClick={onClose}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/40 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <X size={18} />
            </button>

            <div className="p-5 sm:p-6 space-y-4">
              <h2 className="text-lg font-bold text-white font-outfit flex items-center gap-2 pr-8">
                <BookOpen size={18} className="text-cyan-400" />
                {entityName}
                {page?.type && <span className="font-mono text-[10px] text-cyan-300 border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 rounded">{page.type}</span>}
              </h2>

              {loading ? (
                <p className="text-xs text-slate-500 py-8 text-center">読み込み中...</p>
              ) : !page ? (
                <p className="text-xs text-slate-500 py-8 text-center">情報を取得できませんでした</p>
              ) : empty ? (
                <p className="text-xs text-slate-500 py-8 text-center">このエンティティの詳細情報はまだありません</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {page.benchmarks.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold text-amber-300 mb-1.5 flex items-center gap-1"><Trophy size={12} />ベンチマーク</p>
                      <div className="flex flex-col gap-1">
                        {page.benchmarks.map((b, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="text-slate-300 truncate flex-1">{b.benchmark}</span>
                            <span className="font-mono text-amber-300">{b.score}{b.unit ?? ''}</span>
                            {b.date && <span className="font-mono text-[10px] text-slate-600">{b.date}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {page.relations.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold text-indigo-300 mb-1.5 flex items-center gap-1"><Network size={12} />関係</p>
                      <div className="flex flex-col gap-1">
                        {page.relations.map((r, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs">
                            <span className="font-mono text-[10px] text-slate-500 flex-shrink-0">{RELATION_LABEL[r.type] ?? r.type}</span>
                            <ArrowRight size={11} className={`text-indigo-400 flex-shrink-0 ${r.dir === 'in' ? 'rotate-180' : ''}`} />
                            <button onClick={() => onOpenEntity?.(r.other)}
                              className={`truncate text-left ${onOpenEntity ? 'text-slate-200 hover:text-cyan-300 transition-colors' : 'text-slate-200'}`}>
                              {r.other}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {page.claims.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold text-emerald-300 mb-1.5 flex items-center gap-1"><Sparkles size={12} />判明している事実</p>
                      <div className="flex flex-col gap-1">
                        {page.claims.map((c, i) => (
                          <div key={i} className="text-xs text-slate-300"><span className="text-slate-500">{c.predicate}:</span> {c.value}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {page.articles.length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold text-sky-300 mb-1.5 flex items-center gap-1"><BookOpen size={12} />関連記事</p>
                      <div className="flex flex-col gap-1">
                        {page.articles.map(a => (
                          <button key={a.id} onClick={() => onOpenArticle?.(a.id)}
                            className="flex items-center gap-2 text-left text-xs text-slate-300 hover:text-white rounded px-1.5 py-1 hover:bg-white/5 transition-colors group">
                            <span className="truncate flex-1">{a.title}</span>
                            <span className="font-mono text-[10px] text-slate-600 flex-shrink-0">★{a.importance}</span>
                            <ArrowRight size={11} className="text-slate-600 group-hover:text-sky-400 flex-shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
