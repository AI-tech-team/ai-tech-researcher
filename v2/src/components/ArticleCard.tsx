"use client";

import { useState, useRef, useLayoutEffect } from 'react';
import { Star, Bookmark, ExternalLink, CheckCircle2, Newspaper } from 'lucide-react';
import type { CollectedItem } from '@/types';
import { safeHttpUrl } from '@/lib/safeUrl';

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
  onOpenArticle?: (id: number) => void;
  showReadLater?: boolean;
  highlighted?: boolean;
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
  item, interestTags, onToggleFavorite, onToggleReadLater, onMarkAsRead, onOpenArticle, showReadLater = true, highlighted = false,
}: ArticleCardProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const [isClamped, setIsClamped] = useState(false);

  // 文字数ではなく実際に2行で切り詰められているかで展開可否を判定（短い日本語でも崩れない）
  useLayoutEffect(() => {
    const el = summaryRef.current;
    if (el && !summaryExpanded) {
      setIsClamped(el.scrollHeight > el.clientHeight + 2);
    }
  }, [item.summary, summaryExpanded]);

  const color  = CATEGORY_COLORS[item.category ?? ''] ?? '#475569';
  // 正規化スコアが利用可能で2以上差があれば表示、なければ生スコア
  const displayScore = (item.normalizedImportanceScore != null &&
    Math.abs((item.normalizedImportanceScore) - (item.importanceScore ?? 5)) >= 2)
    ? item.normalizedImportanceScore
    : (item.importanceScore ?? 0);
  const rawScore = item.importanceScore ?? 0;
  // 重要度バッジの色（高=赤/中=橙/低=スレート）。全記事に★スコアを表示する。
  const scoreColor = displayScore >= 9 ? '#f87171' : displayScore >= 8 ? '#fb923c' : '#64748b';
  const isRead = !!item.isRead;
  const isFav  = !!item.isFavorited;
  const isRL   = !!item.isReadLater;
  const safeUrl = safeHttpUrl(item.url); // 外部リンクは http(s) のみ許可（javascript:/data: 等を弾く）
  const isMatch = interestTags.length > 0 && interestTags.some(tag =>
    [item.title, item.summary, item.category].some(f => f?.toLowerCase().includes(tag.toLowerCase()))
  );
  const dateStr = item.publishedAt ?? item.createdAt;
  const showToggle = isClamped || summaryExpanded;

  return (
    <div id={`article-${item.id}`}
      className={`article-row group transition-shadow duration-500 ${highlighted ? 'ring-2 ring-sky-400/70 shadow-[0_0_24px_rgba(56,189,248,0.25)]' : ''}`}>

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

          <span className="font-mono text-[10px] px-1.5 py-px rounded border font-bold flex-shrink-0"
            style={{ color: scoreColor, borderColor: `${scoreColor}28`, background: `${scoreColor}10` }}>
            {/* 正規化スコアと生スコアが異なる場合は両方表示 */}
            {item.normalizedImportanceScore != null && item.normalizedImportanceScore !== rawScore
              ? `★${rawScore}→${item.normalizedImportanceScore}`
              : `★${rawScore}`}
          </span>

          {isMatch && (
            <span className="font-mono text-[10px] text-amber-400 border border-amber-500/20 bg-amber-500/10 px-1.5 py-px rounded">
              MATCH
            </span>
          )}

          {/* v3: 同一ストーリーを複数媒体が報じた場合、どの媒体が報じたかを表示 */}
          {(item.storyCount ?? 1) > 1 && (item.storyOutlets?.length ?? 0) > 0 && (
            <span
              title={`同一トピックを報じた媒体: ${item.storyOutlets!.join('、')}`}
              className="flex items-center gap-0.5 font-mono text-[10px] text-cyan-300 border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-px rounded max-w-full">
              <Newspaper size={10} className="flex-shrink-0" />
              <span className="truncate">
                {item.storyOutlets!.slice(0, 3).join('・')}
                {item.storyOutlets!.length > 3 ? ` 他${item.storyOutlets!.length - 3}媒体` : ''}が報じた
              </span>
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
            {safeUrl && (
              <a href={safeUrl} target="_blank" rel="noopener noreferrer"
                onClick={() => { if (onMarkAsRead && !isRead) onMarkAsRead(item.id, false); }}
                className="p-1.5 rounded-md hover:bg-white/5 text-slate-600 hover:text-white transition-colors">
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>

        {/* Row 2: title（英語タイトルは日本語訳を主表示し、原題を小さく併記） */}
        <div>
          <h4 onClick={() => onOpenArticle?.(item.id)}
            className={`text-sm font-semibold leading-snug transition-colors ${isRead ? 'text-slate-500' : 'text-slate-100 group-hover:text-white'} ${onOpenArticle ? 'cursor-pointer hover:text-sky-300' : ''}`}>
            {item.titleJa || item.title || '無題'}
          </h4>
          {item.titleJa && item.title && item.titleJa !== item.title && (
            <p className="text-[11px] text-slate-600 leading-snug mt-0.5 truncate" title={item.title}>{item.title}</p>
          )}
        </div>

        {/* Row 3: summary（タップで展開） */}
        <div>
          <p
            ref={summaryRef}
            onClick={() => showToggle && setSummaryExpanded(v => !v)}
            className={`text-slate-500 text-xs leading-relaxed ${showToggle ? 'cursor-pointer' : ''} ${summaryExpanded ? '' : 'line-clamp-2'}`}
          >
            {item.summary ?? 'サマリーなし'}
          </p>
          {showToggle && (
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
