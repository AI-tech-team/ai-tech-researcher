"use client";

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { searchArticles } from '@/app/actions';
import type { CollectedItem } from '@/types';

const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': '#38bdf8', 'エージェント': '#818cf8', 'ツール/フレームワーク': '#34d399',
  'ハードウェア': '#fb923c', 'ビジネス応用': '#f472b6', '研究/論文': '#a78bfa', 'その他': '#475569',
};

// 公開UIのグローバル検索（⌘K）。記事をタイトル/サマリーで横断検索して即ジャンプ。
export function SearchPalette({ open, onClose, onSelect }: {
  open: boolean;
  onClose: () => void;
  onSelect: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CollectedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // 開いたらフォーカス＆状態リセット
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQ(''); setResults([]); setSearched(false); setHighlightedIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // ハイライトされた行をスクロール表示
  useEffect(() => {
    if (results.length === 0) return;
    const target = results[highlightedIndex];
    if (!target) return;
    const el = itemRefs.current.get(target.id);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, results]);

  // Escで閉じる
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  // デバウンス検索（2文字未満は描画側で空表示にするのでstateは触らない）
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await searchArticles(term).catch(() => [] as CollectedItem[]);
      if (!cancelled) { setResults(r); setSearched(true); setLoading(false); setHighlightedIndex(0); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  const pick = (id: number) => { onSelect(id); onClose(); };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={onClose}
          className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 backdrop-blur-sm px-4 pt-[12vh]"
        >
          <motion.div
            initial={{ y: -16, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -10, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 340 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#070b16] shadow-2xl overflow-hidden"
          >
            {/* 入力 */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/5">
              <Search size={17} className="text-slate-500 flex-shrink-0" />
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  if (results.length === 0) return;
                  if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightedIndex(i => Math.min(results.length - 1, i + 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightedIndex(i => Math.max(0, i - 1)); }
                  else if (e.key === 'Enter') { e.preventDefault(); const target = results[highlightedIndex]; if (target) pick(target.id); }
                }}
                placeholder="記事を検索…（モデル名・キーワード）"
                maxLength={100}
                className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-600 focus:outline-none"
              />
              <button onClick={onClose} className="p-1 rounded-md hover:bg-white/10 text-slate-500 hover:text-white transition-colors flex-shrink-0">
                <X size={16} />
              </button>
            </div>

            {/* 結果 */}
            <div className="max-h-[55vh] overflow-y-auto">
              {q.trim().length < 2 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-600">2文字以上で検索します</p>
              ) : loading ? (
                <p className="px-4 py-8 text-center text-xs text-slate-600">検索中…</p>
              ) : results.length === 0 && searched ? (
                <p className="px-4 py-8 text-center text-xs text-slate-600">一致する記事がありません</p>
              ) : (
                <div className="py-1">
                  {results.map((item, idx) => {
                    const color = CATEGORY_COLORS[item.category ?? ''] ?? '#475569';
                    const highlighted = idx === highlightedIndex;
                    return (
                      <button key={item.id}
                        ref={el => { if (el) itemRefs.current.set(item.id, el); else itemRefs.current.delete(item.id); }}
                        onMouseEnter={() => setHighlightedIndex(idx)}
                        onClick={() => pick(item.id)}
                        className={`w-full text-left px-4 py-2.5 transition-colors flex flex-col gap-1 border-b border-white/[0.03] last:border-0 ${highlighted ? 'bg-sky-500/10' : 'hover:bg-white/[0.04]'}`}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[9px] font-bold tracking-widest uppercase flex-shrink-0" style={{ color }}>
                            {item.category ?? 'OTHER'}
                          </span>
                          <span className="text-sm text-slate-100 font-medium truncate">{item.titleJa || item.title || '無題'}</span>
                        </div>
                        {item.summary && <p className="text-[11px] text-slate-500 line-clamp-1">{item.summary}</p>}
                      </button>
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
