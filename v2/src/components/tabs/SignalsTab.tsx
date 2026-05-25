"use client";

import { Radar, TrendingUp, ArrowUpRight, Star, FlaskConical } from 'lucide-react';
import { SkeletonStat } from '@/components/Skeleton';
import type { SignalIntel } from '@/app/actions';

const isValidUrl = (u: string | null) => !!u && /^https?:\/\//.test(u) && !u.includes('vertexaisearch.cloud.google.com');

export function SignalsTab({ signals, isLoadingData }: { signals: SignalIntel | null; isLoadingData: boolean }) {
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

  return (
    <div className="space-y-6">
      <p className="text-[11px] text-slate-500">直近7日の動きを、その前3週の平均と比較した「加速シグナル」です（先読みの手がかり）。</p>

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
                <span className="text-xs text-slate-200 truncate flex-1" title={e.name}>{e.name}</span>
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
