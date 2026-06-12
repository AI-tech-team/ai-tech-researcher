"use client";

import Link from 'next/link';
import { Star, Bookmark, CheckCircle2, ExternalLink, ListTree, Newspaper } from 'lucide-react';
import type { ArticleDetail } from '@/app/actions';
import { safeHttpUrl } from '@/lib/safeUrl';
import { ShareButtons } from '@/components/ShareButtons';
import { AiBadge } from '@/components/AiBadge';
import { SITE_URL } from '@/lib/site';

// 記事本文の表示部。モーダル(ArticleDetailModal)と全画面ページ(/articles/[id])の両方で共用する。
// 状態(fav/rl/read)とトグル操作は親が供給する（モーダルは楽観patch、ページはServer Action）。
const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': '#38bdf8', 'エージェント': '#818cf8', 'ツール/フレームワーク': '#34d399',
  'ハードウェア': '#fb923c', 'ビジネス応用': '#f472b6', '研究/論文': '#a78bfa', 'その他': '#475569',
};

interface Props {
  article: ArticleDetail;
  fav: boolean;
  rl: boolean;
  read: boolean;
  onToggleFav: () => void;
  onToggleRl: () => void;
  onToggleRead: () => void;
  /** 「一覧で表示」ボタン。渡されたときだけ表示（モーダル用。全画面ページでは不要）。 */
  onShowInList?: () => void;
}

export function ArticleDetailContent({
  article, fav, rl, read, onToggleFav, onToggleRl, onToggleRead, onShowInList,
}: Props) {
  const color = CATEGORY_COLORS[article.category ?? ''] ?? '#475569';
  const safeUrl = safeHttpUrl(article.url); // javascript:/data:等を弾いてから href に使う

  return (
    <div className="p-5 sm:p-6 space-y-4">
      {/* メタ */}
      <div className="flex items-center gap-2 flex-wrap pr-8">
        {article.category
          ? <Link href={`/category/${encodeURIComponent(article.category)}`} scroll={false}
              className="font-mono text-[10px] font-bold tracking-widest uppercase hover:underline underline-offset-2" style={{ color }}>{article.category}</Link>
          : <span className="font-mono text-[10px] font-bold tracking-widest uppercase" style={{ color }}>OTHER</span>}
        <span title="重要度スコア（AIが判定した注目度。お気に入り数ではありません）"
          className="font-mono text-[10px] px-1.5 py-px rounded border font-bold"
          style={{ color: '#fb923c', borderColor: '#fb923c28', background: '#fb923c10' }}>重要度 ★{article.importanceScore ?? 0}</span>
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
        <h1 className="text-lg sm:text-xl font-bold text-white leading-snug">{article.titleJa || article.title || '無題'}</h1>
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
        <button onClick={onToggleFav}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${fav ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}>
          <Star size={13} className={fav ? 'fill-amber-400' : ''} /> お気に入り
        </button>
        <button onClick={onToggleRl}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${rl ? 'border-sky-500/30 bg-sky-500/10 text-sky-400' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}>
          <Bookmark size={13} className={rl ? 'fill-sky-400' : ''} /> 後で読む
        </button>
        <button onClick={onToggleRead}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${read ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}>
          <CheckCircle2 size={13} /> {read ? '既読' : '既読にする'}
        </button>
        {safeUrl && (
          <a href={safeUrl} target="_blank" rel="noopener noreferrer"
            onClick={() => { if (!read) onToggleRead(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 text-xs font-bold transition-colors">
            <ExternalLink size={13} /> 元記事
          </a>
        )}
        {onShowInList && (
          <button onClick={onShowInList}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 text-xs font-bold transition-colors">
            <ListTree size={13} /> 一覧で表示
          </button>
        )}
      </div>

      {/* サマリー（AIによる要約） */}
      {article.summary && (
        <div className="border-l-2 border-sky-500/30 pl-3">
          <div className="mb-1"><AiBadge label="AI要約" /></div>
          <p className="text-sm text-slate-300 leading-relaxed">{article.summary}</p>
        </div>
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
          {article.tags.slice(0, 6).map(t => (
            <Link key={t} href={`/tag/${encodeURIComponent(t)}`} scroll={false} className="hover:text-slate-300 transition-colors">#{t}</Link>
          ))}
        </div>
      )}

      {/* 共有 */}
      <ShareButtons url={`${SITE_URL}/articles/${article.id}`} title={article.titleJa || article.title || '無題'} />
    </div>
  );
}
