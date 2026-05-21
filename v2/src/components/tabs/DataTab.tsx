"use client";

import { useState, useEffect } from 'react';
import { Search, Brain, Award, Database, Eye, Tag, ChevronLeft, ChevronRight } from 'lucide-react';
import { ArticleCard } from '@/components/ArticleCard';
import { SkeletonCard } from '@/components/Skeleton';
import { semanticSearch } from '@/app/actions';
import { useToast } from '@/components/Toast';
import type { CollectedItem } from '@/types';

interface DataTabProps {
  collectedItems: CollectedItem[];
  isLoadingData: boolean;
  interestTags: string[];
  onToggleFavorite: (id: number, current: boolean) => void;
  onToggleReadLater: (id: number, current: boolean) => void;
  onMarkAsRead: (id: number, current: boolean) => void;
}

export function DataTab({
  collectedItems, isLoadingData, interestTags,
  onToggleFavorite, onToggleReadLater, onMarkAsRead,
}: DataTabProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [isSemanticSearching, setIsSemanticSearching] = useState(false);
  const [semanticResults, setSemanticResults] = useState<CollectedItem[] | null>(null);
  const [sortByImportance, setSortByImportance] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // フィルタ変更時にページを先頭へ戻す（意図的なリセット）
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(0); }, [searchQuery, categoryFilter, tagFilter, sortByImportance, unreadOnly, semanticResults]);

  const categories = ['all', ...Array.from(new Set(collectedItems.map(i => i.category).filter(Boolean))) as string[]];

  // 全記事のタグを集約
  const allTags = Array.from(new Set(
    collectedItems.flatMap(i => i.tags ?? []).filter(Boolean)
  )).sort();

  const baseItems = semanticResults ?? collectedItems;
  const filteredItems = baseItems.filter(item => {
    const matchSearch = !searchQuery || semanticResults != null ||
      item.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.summary?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCategory = categoryFilter === 'all' || item.category === categoryFilter;
    const matchTag = tagFilter === 'all' || (item.tags ?? []).includes(tagFilter);
    const matchUnread = !unreadOnly || !item.isRead;
    return matchSearch && matchCategory && matchTag && matchUnread;
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sortByImportance) return (b.importanceScore ?? 5) - (a.importanceScore ?? 5);
    if (interestTags.length > 0) {
      const aMatch = interestTags.some(tag => [a.title, a.summary, a.category].some(f => f?.toLowerCase().includes(tag.toLowerCase())));
      const bMatch = interestTags.some(tag => [b.title, b.summary, b.category].some(f => f?.toLowerCase().includes(tag.toLowerCase())));
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
    }
    return 0;
  });

  const unreadCount = collectedItems.filter(i => !i.isRead).length;
  const totalPages = Math.ceil(sortedItems.length / PAGE_SIZE);
  const pagedItems = sortedItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSemanticSearch = async () => {
    if (!searchQuery.trim() || isSemanticSearching) return;
    setIsSemanticSearching(true);
    try {
      const results = await semanticSearch(searchQuery);
      setSemanticResults(results as CollectedItem[]);
    } catch {
      toast('AI検索に失敗しました', 'error');
    } finally {
      setIsSemanticSearching(false);
    }
  };

  const handleToggleReadLaterLocal = async (id: number, current: boolean) => {
    if (semanticResults) {
      setSemanticResults(prev => prev ? prev.map(x => x.id === id ? { ...x, isReadLater: current ? 0 : 1 } : x) : null);
    }
    await onToggleReadLater(id, current);
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); if (!e.target.value) setSemanticResults(null); }}
            onKeyDown={e => e.key === 'Enter' && handleSemanticSearch()}
            placeholder="タイトル・サマリーを検索..."
            maxLength={200}
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-9 pr-4 text-sm text-white focus:outline-none focus:border-sky-500/50 transition-colors"
          />
        </div>
        <button
          onClick={handleSemanticSearch}
          disabled={isSemanticSearching || !searchQuery.trim()}
          className="flex items-center gap-2 bg-purple-500/20 border border-purple-500/30 text-purple-300 px-4 py-2 rounded-xl text-sm font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50"
          title="Geminiがクエリを意味解析して検索"
        >
          <Brain size={15} className={isSemanticSearching ? 'animate-pulse' : ''} />
          AI検索
        </button>
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Tag size={13} className="text-slate-500 flex-shrink-0" />
          <button
            onClick={() => setTagFilter('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${tagFilter === 'all' ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
          >
            全タグ
          </button>
          {allTags.slice(0, 12).map(tag => (
            <button
              key={tag}
              onClick={() => setTagFilter(tag === tagFilter ? 'all' : tag)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${tagFilter === tag ? 'bg-indigo-500/80 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Filters + sort */}
      <div className="flex flex-wrap items-center gap-2">
        {categories.map(cat => (
          <button key={cat} onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${categoryFilter === cat ? 'bg-sky-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>
            {cat === 'all' ? '全て' : cat}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setUnreadOnly(!unreadOnly)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${unreadOnly ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
          >
            <Eye size={12} /> 未読のみ{unreadCount > 0 && ` (${unreadCount})`}
          </button>
          <button
            onClick={() => setSortByImportance(!sortByImportance)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${sortByImportance ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
          >
            <Award size={12} /> 重要度順
          </button>
          {semanticResults != null && (
            <button onClick={() => setSemanticResults(null)} className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
              AI検索: {semanticResults.length}件 ×
            </button>
          )}
          <p className="text-xs text-slate-500">{sortedItems.length}件</p>
        </div>
      </div>

      {/* Items */}
      {isLoadingData ? (
        <div className="grid grid-cols-1 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : sortedItems.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-4">
            {pagedItems.map(item => (
              <ArticleCard
                key={item.id}
                item={item}
                interestTags={interestTags}
                onToggleFavorite={onToggleFavorite}
                onToggleReadLater={handleToggleReadLaterLocal}
                onMarkAsRead={onMarkAsRead}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="font-mono text-xs text-slate-500">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="glass-card text-center py-20 text-slate-400">
          <Database size={48} className="mx-auto mb-4 opacity-20" />
          <p>データが見つかりません。</p>
        </div>
      )}
    </div>
  );
}
