"use client";

import { Star, Bookmark, ExternalLink, Hash, Clock, Award, Eye, EyeOff } from 'lucide-react';
import type { CollectedItem } from '@/types';

const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': '#38bdf8',
  'エージェント': '#818cf8',
  'ツール/フレームワーク': '#34d399',
  'ハードウェア': '#fb923c',
  'ビジネス応用': '#f472b6',
  '研究/論文': '#a78bfa',
  'その他': '#94a3b8',
};

interface ArticleCardProps {
  item: CollectedItem;
  interestTags: string[];
  onToggleFavorite: (id: number, current: boolean) => void;
  onToggleReadLater: (id: number, current: boolean) => void;
  onMarkAsRead?: (id: number, current: boolean) => void;
  showReadLater?: boolean;
}

export function ArticleCard({
  item, interestTags, onToggleFavorite, onToggleReadLater, onMarkAsRead, showReadLater = true,
}: ArticleCardProps) {
  const isInterestMatch = interestTags.length > 0 && interestTags.some(tag =>
    [item.title, item.summary, item.category].some(f => f?.toLowerCase().includes(tag.toLowerCase()))
  );
  const color = CATEGORY_COLORS[item.category ?? ''] ?? '#94a3b8';
  const score = item.importanceScore ?? 0;
  const isRead = !!item.isRead;

  const handleLinkClick = () => {
    if (onMarkAsRead && !isRead) {
      onMarkAsRead(item.id, false);
    }
  };

  return (
    <div className={`glass-card group hover:border-sky-500/30 transition-opacity ${isRead ? 'opacity-60' : ''}`}>
      <div className="flex justify-between items-start mb-2">
        <h4 className={`text-base font-bold group-hover:text-sky-400 transition-colors flex-1 pr-4 leading-snug ${isRead ? 'text-slate-400' : 'text-white'}`}>
          {item.title || '無題のデータ'}
        </h4>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isInterestMatch && (
            <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full">おすすめ</span>
          )}
          {score >= 8 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-bold flex items-center gap-0.5 ${
              score >= 9 ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-orange-500/10 text-orange-400 border-orange-500/20'
            }`}>
              <Award size={9} />{score}
            </span>
          )}
          {onMarkAsRead && (
            <button
              onClick={() => onMarkAsRead(item.id, isRead)}
              title={isRead ? '未読に戻す' : '既読にする'}
              className="p-1 rounded hover:bg-white/5 transition-colors"
            >
              {isRead
                ? <EyeOff size={15} className="text-slate-600 hover:text-slate-400 transition-colors" />
                : <Eye size={15} className="text-slate-600 hover:text-emerald-400 transition-colors" />
              }
            </button>
          )}
          <button
            onClick={() => onToggleFavorite(item.id, !!item.isFavorited)}
            title={item.isFavorited ? 'お気に入り解除' : 'お気に入り'}
            className="p-1 rounded hover:bg-white/5 transition-colors"
          >
            <Star size={15} className={item.isFavorited ? 'fill-amber-400 text-amber-400' : 'text-slate-600 hover:text-amber-400 transition-colors'} />
          </button>
          {showReadLater && (
            <button
              onClick={() => onToggleReadLater(item.id, !!item.isReadLater)}
              title={item.isReadLater ? '後で読むを解除' : '後で読む'}
              className="p-1 rounded hover:bg-white/5 transition-colors"
            >
              <Bookmark size={15} className={item.isReadLater ? 'fill-sky-400 text-sky-400' : 'text-slate-600 hover:text-sky-400 transition-colors'} />
            </button>
          )}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleLinkClick}
              className="p-1 rounded text-slate-500 hover:text-white transition-colors"
            >
              <ExternalLink size={15} />
            </a>
          )}
        </div>
      </div>

      <p className="text-slate-400 text-sm line-clamp-2 mb-3">{item.summary || 'サマリーはありません'}</p>

      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {item.tags.map(tag => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-white/5 text-slate-500 border border-white/10 rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap text-xs font-medium">
        {item.category && (
          <span className="px-2 py-1 rounded-md border" style={{
            backgroundColor: `${color}15`,
            color,
            borderColor: `${color}30`,
          }}>
            {item.category}
          </span>
        )}
        <span className="flex items-center gap-1 text-sky-400 bg-sky-500/10 px-2 py-1 rounded-md">
          <Hash size={11} />{item.sourceValue || '不明'}
        </span>
        <span className="flex items-center gap-1 text-slate-500">
          <Clock size={11} />
          {new Date(item.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
