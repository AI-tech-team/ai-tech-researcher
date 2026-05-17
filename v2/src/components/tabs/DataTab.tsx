"use client";

import { useState, useEffect } from 'react';
import { Search, Brain, Award, Database } from 'lucide-react';
import { ArticleCard } from '@/components/ArticleCard';
import { SkeletonCard } from '@/components/Skeleton';
import { semanticSearch } from '@/app/actions';
import { useToast } from '@/components/Toast';
import type { CollectedItem } from '@/types';

interface DataTabProps {
  collectedItems: CollectedItem[];
  isLoadingData: boolean;
  interestTags: string[];
  onInterestTagsChange: (tags: string[]) => void;
  onToggleFavorite: (id: number, current: boolean) => void;
  onToggleReadLater: (id: number, current: boolean) => void;
}

export function DataTab({
  collectedItems, isLoadingData, interestTags, onInterestTagsChange,
  onToggleFavorite, onToggleReadLater,
}: DataTabProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [newInterestTag, setNewInterestTag] = useState('');
  const [isSemanticSearching, setIsSemanticSearching] = useState(false);
  const [semanticResults, setSemanticResults] = useState<CollectedItem[] | null>(null);
  const [sortByImportance, setSortByImportance] = useState(false);

  const categories = ['all', ...Array.from(new Set(collectedItems.map(i => i.category).filter(Boolean))) as string[]];

  const baseItems = semanticResults ?? collectedItems;
  const filteredItems = baseItems.filter(item => {
    const matchSearch = !searchQuery || semanticResults != null ||
      item.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.summary?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCategory = categoryFilter === 'all' || item.category === categoryFilter;
    return matchSearch && matchCategory;
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

  const addInterestTag = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = newInterestTag.trim();
    if (!trimmed || interestTags.includes(trimmed)) return;
    const updated = [...interestTags, trimmed];
    onInterestTagsChange(updated);
    localStorage.setItem('interestTags', JSON.stringify(updated));
    setNewInterestTag('');
  };

  const removeInterestTag = (tag: string) => {
    const updated = interestTags.filter(t => t !== tag);
    onInterestTagsChange(updated);
    localStorage.setItem('interestTags', JSON.stringify(updated));
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

      {/* Interest tags */}
      <div className="flex items-center gap-2 flex-wrap p-3 rounded-xl bg-white/5 border border-white/5">
        <span className="text-xs text-slate-500 font-medium flex-shrink-0">興味タグ:</span>
        {interestTags.map(tag => (
          <span key={tag} className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs flex items-center gap-1">
            {tag}
            <button onClick={() => removeInterestTag(tag)} className="hover:text-red-400 transition-colors ml-0.5">×</button>
          </span>
        ))}
        <form onSubmit={addInterestTag} className="flex gap-1">
          <input
            value={newInterestTag}
            onChange={e => setNewInterestTag(e.target.value)}
            placeholder="+ タグ追加"
            maxLength={30}
            className="bg-transparent border-b border-white/20 text-xs text-slate-400 focus:outline-none focus:border-amber-500/50 w-24 px-1 py-0.5 transition-colors"
          />
        </form>
        {interestTags.length > 0 && (
          <span className="text-[10px] text-amber-400/60">マッチした記事を優先表示</span>
        )}
      </div>

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
        <div className="grid grid-cols-1 gap-4">
          {sortedItems.map(item => (
            <ArticleCard
              key={item.id}
              item={item}
              interestTags={interestTags}
              onToggleFavorite={onToggleFavorite}
              onToggleReadLater={handleToggleReadLaterLocal}
            />
          ))}
        </div>
      ) : (
        <div className="glass-card text-center py-20 text-slate-400">
          <Database size={48} className="mx-auto mb-4 opacity-20" />
          <p>データが見つかりません。</p>
        </div>
      )}
    </div>
  );
}
