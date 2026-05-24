"use client";

import { Fingerprint, TrendingUp, TrendingDown, EyeOff, Compass, ArrowRight } from 'lucide-react';
import { SkeletonStat } from '@/components/Skeleton';
import type { ReadingProfile, CollectedItem } from '@/types';

const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': '#38bdf8', 'エージェント': '#818cf8', 'ツール/フレームワーク': '#34d399',
  'ハードウェア': '#fb923c', 'ビジネス応用': '#f472b6', '研究/論文': '#a78bfa', 'その他': '#94a3b8',
};

interface ReadingDnaTabProps {
  profile: ReadingProfile | null;
  recommendations?: CollectedItem[];
  isLoadingData: boolean;
  onNavigateToArticle?: (id: number) => void;
}

export function ReadingDnaTab({ profile, recommendations = [], isLoadingData, onNavigateToArticle }: ReadingDnaTabProps) {
  if (isLoadingData) {
    return <div className="space-y-4"><SkeletonStat /><SkeletonStat /></div>;
  }

  if (!profile) {
    return (
      <div className="glass-card flex flex-col items-center justify-center py-16 text-slate-500 text-sm gap-2">
        <Fingerprint size={32} className="opacity-20" />
        <span>まだ読書DNAを分析できるデータがありません</span>
        <span className="text-xs">記事を開く・お気に入り・後で読むと、あなたの傾向が見えてきます</span>
      </div>
    );
  }

  const maxCat = Math.max(1, ...profile.categoryDistribution.map(c => c.count));

  return (
    <div className="space-y-8">

      {/* ペルソナ */}
      <div className="glass-card border-indigo-500/20 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
          <Fingerprint className="text-white" size={24} />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">あなたの読書DNA</p>
          <h2 className="text-xl font-bold font-outfit text-white">{profile.persona || '分析中'}</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{profile.totalEvents}件の行動から分析</p>
        </div>
      </div>

      {/* 4軸プロファイル（双極スライダー） */}
      <div className="glass-card">
        <h3 className="text-sm font-bold font-outfit mb-4">4軸プロファイル</h3>
        <div className="flex flex-col gap-5">
          {profile.radar.map(ax => (
            <div key={ax.axis}>
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className={ax.value <= 45 ? 'text-white font-semibold' : 'text-slate-500'}>{ax.leftLabel}</span>
                <span className="font-mono text-[10px] text-indigo-300">{ax.axis}</span>
                <span className={ax.value >= 55 ? 'text-white font-semibold' : 'text-slate-500'}>{ax.rightLabel}</span>
              </div>
              <div className="relative h-2 rounded-full bg-white/10">
                <div className="absolute top-1/2 -translate-y-1/2 left-1/2 w-px h-3 bg-white/20" />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 shadow-lg shadow-indigo-500/40 -ml-1.5"
                  style={{ left: `${ax.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* カテゴリ分布 */}
        <div className="glass-card">
          <h3 className="text-sm font-bold font-outfit mb-3">関心カテゴリ分布</h3>
          <div className="flex flex-col gap-2">
            {profile.categoryDistribution.map(c => (
              <div key={c.category} className="flex items-center gap-2">
                <span className="text-xs text-slate-300 w-32 truncate" title={c.category}>{c.category}</span>
                <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(c.count / maxCat) * 100}%`, background: CATEGORY_COLORS[c.category] ?? '#94a3b8' }} />
                </div>
                <span className="font-mono text-[10px] text-slate-500 w-6 text-right">{c.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 関心の変化 + 最近読んでいない分野 */}
        <div className="space-y-4">
          <div className="glass-card">
            <h3 className="text-sm font-bold font-outfit mb-3">関心の変化（直近30日 vs その前）</h3>
            {profile.recentShift.length === 0 ? (
              <p className="text-xs text-slate-500">大きな変化はありません</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {profile.recentShift.map(s => (
                  <div key={s.category} className="flex items-center gap-2 text-xs">
                    {s.direction === 'up'
                      ? <TrendingUp size={13} className="text-emerald-400 flex-shrink-0" />
                      : <TrendingDown size={13} className="text-amber-400 flex-shrink-0" />}
                    <span className="text-slate-300 flex-1 truncate">{s.category}</span>
                    <span className={`font-mono text-[11px] ${s.direction === 'up' ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {s.delta > 0 ? `+${s.delta}` : s.delta}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {profile.neglectedCategories.length > 0 && (
            <div className="glass-card border-amber-500/15">
              <h3 className="text-sm font-bold font-outfit mb-2 flex items-center gap-1.5">
                <EyeOff size={14} className="text-amber-400" /> 最近読んでいない分野
              </h3>
              <p className="text-[11px] text-slate-500 mb-2">意識的にカバーすると視野が広がります</p>
              <div className="flex flex-wrap gap-1.5">
                {profile.neglectedCategories.map(c => (
                  <span key={c} className="font-mono text-[10px] text-amber-300 border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 rounded-full">{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* あなたへのおすすめ（プロファイルに近い未読記事） */}
      {recommendations.length > 0 && (
        <div className="glass-card border-indigo-500/20">
          <h3 className="text-sm font-bold font-outfit mb-1 flex items-center gap-2">
            <Compass size={16} className="text-indigo-400" /> あなたへのおすすめ（見逃している記事）
          </h3>
          <p className="text-[11px] text-slate-500 mb-3">あなたの読書傾向に近いのに、まだ読んでいない記事です（クリックで記事タブの該当箇所へ）</p>
          <div className="flex flex-col gap-2">
            {recommendations.map(r => {
              const sc = r.importanceScore ?? 0;
              const scoreColor = sc >= 9 ? '#f87171' : sc >= 8 ? '#fb923c' : '#64748b';
              return (
                <div key={r.id}
                  onClick={() => onNavigateToArticle?.(r.id)}
                  className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 hover:bg-white/5 transition-colors cursor-pointer group">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-200 leading-snug truncate group-hover:text-white transition-colors">{r.titleJa || r.title}</p>
                    <span className="font-mono text-[10px] text-slate-600">{r.category ?? '—'}</span>
                  </div>
                  <span className="font-mono text-[10px] px-1.5 py-px rounded border font-bold flex-shrink-0"
                    style={{ color: scoreColor, borderColor: `${scoreColor}28`, background: `${scoreColor}10` }}>
                    ★{sc}
                  </span>
                  <ArrowRight size={13} className="text-slate-600 group-hover:text-indigo-400 transition-colors flex-shrink-0" />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
