"use client";

import { Radar, TrendingUp, ArrowUpRight, Star, FlaskConical, Target } from 'lucide-react';
import { SkeletonStat } from '@/components/Skeleton';
import type { SignalIntel } from '@/app/actions';

const isValidUrl = (u: string | null) => !!u && /^https?:\/\//.test(u) && !u.includes('vertexaisearch.cloud.google.com');

export function SignalsTab({ signals, isLoadingData, onOpenEntity, interestTags }: { signals: SignalIntel | null; isLoadingData: boolean; onOpenEntity?: (name: string) => void; interestTags?: string[] }) {
  if (isLoadingData) {
    return <div className="space-y-4"><SkeletonStat /><SkeletonStat /></div>;
  }
  const sig = signals;
  const hasAny = sig && (sig.categoryVelocity.some(c => c.delta > 0) || sig.risingEntities.length > 0 || sig.hotRepos.length > 0);
  if (!sig || !hasAny) {
    return (
      <div className="glass-card flex flex-col items-center justify-center py-16 text-slate-500 text-sm gap-2">
        <Radar size={32} className="opacity-20" />
        <span>まだ十分なシグナルがありません</span>
        <span className="text-xs">収集が数日進むと、加速している分野・エンティティ・OSSが見えてきます</span>
      </div>
    );
  }

  const accelCats = sig.categoryVelocity.filter(c => c.delta > 0).slice(0, 6);

  // あなた事化: 興味タグに一致する加速分野・伸びるエンティティを先頭で強調（追加コスト0・クライアント側）
  const tokens = (interestTags ?? []).map(t => t.toLowerCase()).filter(t => t.length >= 2);
  const myCats = tokens.length ? sig.categoryVelocity.filter(c => c.delta > 0 && tokens.some(t => c.category.toLowerCase().includes(t) || t.includes(c.category.toLowerCase()))) : [];
  const myEntities = tokens.length ? sig.risingEntities.filter(e => tokens.some(t => e.name.toLowerCase().includes(t))) : [];
  const hasPersonal = myCats.length > 0 || myEntities.length > 0;

  return (
    <div className="space-y-6">
      <p className="text-[11px] text-slate-500">直近7日の動きを、その前3週の平均と比較した「加速シグナル」です（先読みの手がかり）。</p>

      {hasPersonal && (
        <div className="glass-card border-indigo-500/30 bg-indigo-500/5">
          <h3 className="text-sm font-bold font-outfit mb-2 flex items-center gap-2">
            <Target size={16} className="text-indigo-400" /> あなたに関係する動き
          </h3>
          <p className="text-[11px] text-slate-500 mb-3">あなたの興味に一致する、いま加速しているシグナルです</p>
          <div className="flex flex-wrap gap-2">
            {myCats.map(c => (
              <span key={`c-${c.category}`} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
                {c.category} <span className="font-mono text-[10px] flex items-center gap-0.5"><ArrowUpRight size={11} />+{c.delta}/週</span>
              </span>
            ))}
            {myEntities.map(e => (
              <button key={`e-${e.name}`} onClick={() => onOpenEntity?.(e.name)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-300 text-xs ${onOpenEntity ? 'hover:bg-sky-500/20 transition-colors' : ''}`}>
                {e.name} <span className="font-mono text-[10px] flex items-center gap-0.5"><ArrowUpRight size={11} />+{e.delta}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 研究/分野の加速 */}
      {accelCats.length > 0 && (
        <div className="glass-card">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <FlaskConical size={16} className="text-emerald-400" /> 加速している分野（カテゴリ別）
          </h3>
          <div className="flex flex-col gap-2">
            {accelCats.map(c => (
              <div key={c.category} className="flex items-center gap-3">
                <span className="text-xs text-slate-300 w-40 truncate" title={c.category}>{c.category}</span>
                <div className="flex-1 flex items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-500">{c.prevAvg}/週 →</span>
                  <span className="font-mono text-sm font-bold text-emerald-400">{c.thisWeek}</span>
                  <span className="flex items-center gap-0.5 font-mono text-[11px] text-emerald-400"><ArrowUpRight size={12} />+{c.delta}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 伸びるエンティティ */}
      {sig.risingEntities.length > 0 && (
        <div className="glass-card border-sky-500/20">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <TrendingUp size={16} className="text-sky-400" /> 伸びるエンティティ（言及の加速）
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sig.risingEntities.map(e => (
              <div key={e.name} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/5 bg-white/[0.02]">
                <button onClick={() => onOpenEntity?.(e.name)} title={e.name}
                  className={`text-xs text-slate-200 truncate flex-1 text-left ${onOpenEntity ? 'hover:text-cyan-300 transition-colors' : ''}`}>{e.name}</button>
                <span className="font-mono text-[10px] text-slate-500">{e.prevAvg}→{e.thisWeek}</span>
                <span className="font-mono text-[11px] text-sky-400 flex items-center gap-0.5"><ArrowUpRight size={11} />+{e.delta}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 注目OSS */}
      {sig.hotRepos.length > 0 && (
        <div className="glass-card border-amber-500/20">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <Star size={16} className="text-amber-400" /> 注目OSS（直近のGitHubトレンド）
          </h3>
          <div className="flex flex-col gap-1.5">
            {sig.hotRepos.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Star size={11} className="text-amber-400 flex-shrink-0" />
                <span className="font-mono text-[11px] text-amber-300 w-16 flex-shrink-0">⭐{r.stars.toLocaleString()}</span>
                {isValidUrl(r.url)
                  ? <a href={r.url!} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-amber-300 truncate transition-colors">{r.title}</a>
                  : <span className="text-slate-300 truncate">{r.title}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
