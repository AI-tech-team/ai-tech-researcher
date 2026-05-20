"use client";

import { useState } from 'react';
import { Star, Bookmark, ExternalLink, CheckCircle2 } from 'lucide-react';
import type { CollectedItem } from '@/types';

const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論':          '#38bdf8',
  'エージェント':      '#818cf8',
  'ツール/フレームワーク': '#34d399',
  'ハードウェア':      '#fb923c',
  'ビジネス応用':      '#f472b6',
  '研究/論文':         '#a78bfa',
  'その他':           '#475569',
};

interface ArticleCardProps {
  item: CollectedItem;
  interestTags: string[];
  onToggleFavorite: (id: number, current: boolean) => void;
  onToggleReadLater: (id: number, current: boolean) => void;
  onMarkAsRead?: (id: number, current: boolean) => void;
  showReadLater?: boolean;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (h < 1)  return '<1h';
  if (h < 24) return `${h}h`;
  if (d < 7)  return `${d}d`;
  return new Date(dateStr).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

export function ArticleCard({
  item, interestTags, onToggleFavorite, onToggleReadLater, onMarkAsRead, showReadLater = true,
}: ArticleCardProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  const color  = CATEGORY_COLORS[item.category ?? ''] ?? '#475569';
  // 正規化スコアが利用可能で2以上差があれば表示、なければ生スコア
  const displayScore = (item.normalizedImportanceScore != null &&
    Math.abs((item.normalizedImportanceScore) - (item.importanceScore ?? 5)) >= 2)
    ? item.normalizedImportanceScore
    : (item.importanceScore ?? 0);
  const rawScore = item.importanceScore ?? 0;
  const isRead = !!item.isRead;
  const isFav  = !!item.isFavorited;
  const isRL   = !!item.isReadLater;
  const isMatch = interestTags.length > 0 && interestTags.some(tag =>
    [item.title, item.summary, item.category].some(f => f?.toLowerCase().includes(tag.toLowerCase()))
  );
  const dateStr = item.publishedAt ?? item.createdAt;
  const canExpand = (item.summary?.length ?? 0) > 100;

  return (
    <div className="article-row group">

      {/* Left accent bar — 既読時に薄くなる */}
      <div
        className="w-[3px] flex-shrink-0 transition-opacity duration-200"
        style={{ background: color, opacity: isRead ? 0.3 : 1 }}
      />

      <div className="flex-1 min-w-0 px-4 py-3 flex flex-col gap-1.5">

        {/* Row 1: category + badges + actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] font-bold tracking-widest uppercase"
            style={{ color: isRead ? `${color}70` : color }}>
            {item.category ?? 'OTHER'}
          </span>

          {/* 既読バッジ */}
          {isRead && (
            <span className="flex items-center gap-0.5 font-mono text-[10px] text-emerald-700 border border-emerald-900/60 bg-emerald-950/50 px-1.5 py-px rounded-md">
              <CheckCircle2 size={10} />
              READ
            </span>
          )}

          {displayScore >= 8 && (
            <span className="font-mono text-[10px] px-1.5 py-px rounded border font-bold flex-shrink-0"
              style={{
                color: displayScore >= 9 ? '#f87171' : '#fb923c',
                borderColor: displayScore >= 9 ? '#f8717128' : '#fb923c28',
                background: displayScore >= 9 ? '#f8717110' : '#fb923c10',
              }}>
              {/* 正規化スコアと生スコアが異なる場合は両方表示 */}
              {item.normalizedImportanceScore != null && item.normalizedImportanceScore !== rawScore
                ? `★${rawScore}→${item.normalizedImportanceScore}`
                : `★${rawScore}`}
            </span>
          )}

          {isMatch && (
            <span className="font-mono text-[10px] text-amber-400 border border-amber-500/20 bg-amber-500/10 px-1.5 py-px rounded">
              MATCH
            </span>
          )}

          {/* Actions */}
          <div className="ml-auto flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150">
            {onMarkAsRead && (
              <button
                onClick={() => onMarkAsRead(item.id, isRead)}
                title={isRead ? '未読に戻す' : '既読にする'}
                className="px-2 py-1 font-mono text-[10px] rounded border transition-colors"
                style={isRead
                  ? { color: '#64748b', borderColor: 'rgba(255,255,255,0.08)' }
                  : { color: '#10b981', borderColor: 'rgba(16,185,129,0.2)', background: 'rgba(16,185,129,0.07)' }}>
                {isRead ? 'UNREAD' : 'READ'}
              </button>
            )}
            <button onClick={() => onToggleFavorite(item.id, isFav)}
              title={isFav ? 'お気に入り解除' : 'お気に入り'}
              className="p-1.5 rounded-md hover:bg-white/5 transition-colors">
              <Star size={13} className={isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-600 hover:text-amber-400 transition-colors'} />
            </button>
            {showReadLater && (
              <button onClick={() => onToggleReadLater(item.id, isRL)}
                title={isRL ? '後で読むを解除' : '後で読む'}
                className="p-1.5 rounded-md hover:bg-white/5 transition-colors">
                <Bookmark size={13} className={isRL ? 'fill-sky-400 text-sky-400' : 'text-slate-600 hover:text-sky-400 transition-colors'} />
              </button>
            )}
            {item.url && (
              <a href={item.url} target="_blank" rel="noopener noreferrer"
                onClick={() => { if (onMarkAsRead && !isRead) onMarkAsRead(item.id, false); }}
                className="p-1.5 rounded-md hover:bg-white/5 text-slate-600 hover:text-white transition-colors">
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>

        {/* Row 2: title */}
        <h4 className={`text-sm font-semibold leading-snug ${isRead ? 'text-slate-500' : 'text-slate-100 group-hover:text-white'} transition-colors`}>
          {item.title ?? '無題'}
        </h4>

        {/* Row 3: summary（タップで展開） */}
        <div>
          <p
            onClick={() => canExpand && setSummaryExpanded(v => !v)}
            className={`text-slate-500 text-xs leading-relaxed ${canExpand ? 'cursor-pointer' : ''} ${summaryExpanded ? '' : 'line-clamp-2'}`}
          >
            {item.summary ?? 'サマリーなし'}
          </p>
          {canExpand && (
            <button
              onClick={() => setSummaryExpanded(v => !v)}
              className="font-mono text-[10px] text-slate-700 hover:text-slate-400 transition-colors mt-0.5"
            >
              {summaryExpanded ? '▴ 閉じる' : '▾ 続きを見る'}
            </button>
          )}
        </div>

        {/* Row 4: tags + source + date */}
        <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] text-slate-700 mt-0.5">
          {item.tags?.slice(0, 3).map(tag => (
            <span key={tag} className="text-slate-600">#{tag}</span>
          ))}
          <span className="ml-auto flex items-center gap-2 text-slate-600">
            {item.sourceValue && (
              <span style={{ color: isRead ? '#475569' : `${color}90` }}>{item.sourceValue}</span>
            )}
            <span>·</span>
            <span>{timeAgo(dateStr)}</span>
          </span>
        </div>

      </div>
    </div>
  );
}
