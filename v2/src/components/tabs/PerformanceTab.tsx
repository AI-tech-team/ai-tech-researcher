"use client";

import { TrendingUp, Zap, Hash, Activity } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { SkeletonRow } from '@/components/Skeleton';
import type { Source, CollectedItem, SourcePerformance, PipelineLog } from '@/types';

const scoreToPercent = (score: number) => Math.min(100, Math.max(0, (score + 20) * 2.5));

function getStatusColor(status: string) {
  switch (status) {
    case 'active': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'candidate': return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
    case 'low-priority': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  }
}

interface PerformanceTabProps {
  sourcesList: Source[];
  collectedItems: CollectedItem[];
  sourcePerformance: (SourcePerformance & { avgImportance?: number; roi?: number })[];
  kwMatrix: { keywords: string[]; categories: string[]; matrix: any[]; maxCount: number };
  pipelineLogs: PipelineLog[];
  isLoadingData: boolean;
}

export function PerformanceTab({
  sourcesList, collectedItems, sourcePerformance, kwMatrix, pipelineLogs, isLoadingData,
}: PerformanceTabProps) {
  const stats = [
    { label: '総収集件数', value: collectedItems.length, color: 'text-sky-400' },
    { label: 'お気に入り登録', value: collectedItems.filter(i => i.isFavorited).length, color: 'text-amber-400' },
    { label: '稼働中キーワード', value: sourcesList.filter(s => s.status === 'active').length, color: 'text-emerald-400' },
  ];

  const logChartData = [...pipelineLogs]
    .reverse()
    .slice(-14)
    .map(l => ({
      date: l.date.slice(5),
      収集数: l.collected,
      失敗数: l.failed,
      所要時間: Math.round(l.durationMs / 1000),
    }));

  const TOOLTIP_STYLE = {
    contentStyle: { background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' },
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {stats.map((s, i) => (
          <div key={i} className="glass-card text-center py-4 md:py-6">
            <p className="text-slate-500 text-[10px] md:text-xs uppercase tracking-wider mb-1 md:mb-2">{s.label}</p>
            <p className={`text-2xl md:text-4xl font-bold font-outfit ${s.color}`}>{isLoadingData ? '-' : s.value}</p>
          </div>
        ))}
      </div>

      {/* Pipeline Logs Chart */}
      {logChartData.length > 0 && (
        <div className="glass-card h-[220px]">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <Activity size={16} className="text-sky-400" /> パイプライン実行ログ（直近14日）
          </h3>
          <ResponsiveContainer width="100%" height="80%">
            <AreaChart data={logChartData}>
              <defs>
                <linearGradient id="colorCollected" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="収集数" stroke="#38bdf8" strokeWidth={2} fillOpacity={1} fill="url(#colorCollected)" />
              <Area type="monotone" dataKey="失敗数" stroke="#f87171" strokeWidth={2} fillOpacity={1} fill="url(#colorFailed)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Performance Table with ROI */}
      <div className="glass-card p-0 overflow-hidden">
        <h3 className="text-sm font-bold font-outfit px-6 pt-6 pb-4 flex items-center gap-2">
          <Zap size={16} className="text-amber-400" /> キーワード別パフォーマンス（ROI順）
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400 uppercase bg-white/5 border-b border-white/5">
              <tr>
                <th className="px-6 py-3">キーワード</th>
                <th className="px-6 py-3">ステータス</th>
                <th className="px-6 py-3">スコア</th>
                <th className="px-6 py-3">収集数</th>
                <th className="px-6 py-3">重要度avg</th>
                <th className="px-6 py-3">ROI</th>
                <th className="px-6 py-3">最終ヒット</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingData
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                : sourcePerformance.map(src => {
                  const roi = src.roi ?? 0;
                  const maxRoi = Math.max(1, ...sourcePerformance.map(s => s.roi ?? 0));
                  return (
                    <tr key={src.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-6 py-3.5 font-medium text-white">
                        <span className="flex items-center gap-2">
                          <Hash size={13} className="text-sky-400 flex-shrink-0" />{src.value}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold border ${getStatusColor(src.status)}`}>
                          {src.status}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-sky-400 to-purple-500" style={{ width: `${scoreToPercent(src.score ?? 0)}%` }} />
                          </div>
                          <span className="text-slate-400 font-mono text-xs">{(src.score ?? 0).toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={`font-bold font-mono text-sm ${Number(src.collectedCount) > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {src.collectedCount ?? 0}件
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="text-orange-400 font-mono text-xs">
                          {(src as any).avgImportance ? Number((src as any).avgImportance).toFixed(1) : '-'}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-orange-400 to-rose-500" style={{ width: `${(roi / maxRoi) * 100}%` }} />
                          </div>
                          <span className="text-orange-400 font-mono text-xs font-bold">{roi.toFixed(0)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3.5 text-slate-400 text-xs">
                        {src.lastHitAt ? new Date(src.lastHitAt).toLocaleDateString('ja-JP') : '-'}
                      </td>
                    </tr>
                  );
                })
              }
            </tbody>
          </table>
        </div>
      </div>

      {kwMatrix.keywords.length > 0 && (
        <div className="glass-card">
          <h3 className="text-sm font-bold font-outfit mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-emerald-400" /> キーワード×カテゴリ 共起ヒートマップ
          </h3>
          <div className="overflow-x-auto">
            <div className="flex items-center gap-1 mb-2 ml-32">
              {kwMatrix.categories.map(cat => (
                <div key={cat} className="w-16 text-[9px] text-slate-500 text-center truncate" title={cat}>
                  {cat.replace('/フレームワーク', '').replace('ビジネス応用', 'ビジネス').replace('研究/論文', '研究')}
                </div>
              ))}
            </div>
            {kwMatrix.matrix.map((row: any) => (
              <div key={row.keyword} className="flex items-center gap-1 mb-1">
                <div className="w-32 text-xs text-slate-300 truncate font-medium pr-2" title={row.keyword}>{row.keyword}</div>
                {row.data.map((cnt: number, ci: number) => {
                  const intensity = cnt > 0 ? Math.min(1, cnt / kwMatrix.maxCount) : 0;
                  return (
                    <div
                      key={ci}
                      className="w-16 h-7 rounded flex items-center justify-center text-xs font-bold"
                      style={{
                        backgroundColor: `rgba(99,102,241,${intensity * 0.85})`,
                        color: intensity > 0.4 ? 'white' : '#64748b',
                      }}
                      title={`${kwMatrix.categories[ci]}: ${cnt}件`}
                    >
                      {cnt > 0 ? cnt : ''}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
