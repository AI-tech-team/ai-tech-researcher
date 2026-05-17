"use client";

import { Bookmark } from 'lucide-react';
import { ArticleCard } from '@/components/ArticleCard';
import { SkeletonCard } from '@/components/Skeleton';
import type { CollectedItem } from '@/types';

interface ReadLaterTabProps {
  collectedItems: CollectedItem[];
  isLoadingData: boolean;
  interestTags: string[];
  onToggleFavorite: (id: number, current: boolean) => void;
  onToggleReadLater: (id: number, current: boolean) => void;
}

export function ReadLaterTab({
  collectedItems, isLoadingData, interestTags, onToggleFavorite, onToggleReadLater,
}: ReadLaterTabProps) {
  const readLaterItems = collectedItems.filter(i => i.isReadLater);

  if (isLoadingData) {
    return (
      <div className="grid grid-cols-1 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  if (readLaterItems.length === 0) {
    return (
      <div className="glass-card text-center py-20 text-slate-400">
        <Bookmark size={48} className="mx-auto mb-4 opacity-20" />
        <p className="mb-2">ブックマークした記事がありません。</p>
        <p className="text-xs text-slate-500">
          収集データタブの記事カードにある <Bookmark size={12} className="inline" /> ボタンで登録できます。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">{readLaterItems.length}件のブックマーク</p>
      <div className="grid grid-cols-1 gap-4">
        {readLaterItems.map(item => (
          <ArticleCard
            key={item.id}
            item={item}
            interestTags={interestTags}
            onToggleFavorite={onToggleFavorite}
            onToggleReadLater={onToggleReadLater}
          />
        ))}
      </div>
    </div>
  );
}
