"use client";

import { TrendingUp, Globe, FileText, Star, BarChart3, Database, Brain, Flame, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar as RechartsBar,
} from 'recharts';
import { SkeletonStat } from '@/components/Skeleton';
import type { CollectedItem, Source, Report, TrendingKeyword } from '@/types';

const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': '#38bdf8',
  'エージェント': '#818cf8',
  'ツール/フレームワーク': '#34d399',
  'ハードウェア': '#fb923c',
  'ビジネス応用': '#f472b6',
  '研究/論文': '#a78bfa',
  'その他': '#94a3b8',
};
const CATEGORY_LIST = Object.keys(CATEGORY_COLORS);

const TOOLTIP_STYLE = {
  contentStyle: { background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' },
  itemStyle: { color: '#38bdf8' },
};

interface OverviewTabProps {
  sourcesList: Source[];
  collectedItems: CollectedItem[];
  reportsList: Report[];
  activityData: { name: string; count: number }[];
  categoryTrendData: any[];
  modelMentionData: { model: string; count: number }[];
  trendingKeywords: TrendingKeyword[];
  isLoadingData: boolean;
}

export function OverviewTab({
  sourcesList, collectedItems, reportsList, activityData,
  categoryTrendData, modelMentionData, trendingKeywords, isLoadingData,
}: OverviewTabProps) {
  const chartData = [
    { name: '稼働中', value: sourcesList.filter(s => s.status === 'active').length },
    { name: '候補', value: sourcesList.filter(s => s.status === 'candidate').length },
    { name: '低優先度', value: sourcesList.filter(s => s.status === 'low-priority').length },
  ];

  const stats = [
    { label: '有効な情報源', value: sourcesList.filter(s => s.status === 'active').length, color: 'text-sky-400', icon: <TrendingUp size={20} /> },
    { label: '収集データ件数', value: collectedItems.length, color: 'text-purple-400', icon: <Globe size={20} /> },
    { label: '生成レポート数', value: reportsList.length, color: 'text-emerald-400', icon: <FileText size={20} /> },
    { label: 'お気に入り数', value: collectedItems.filter(i => i.isFavorited).length, color: 'text-amber-400', icon: <Star size={20} /> },
  ];

  return (
    <div className="space-y-8">

      {/* Trending Keywords */}
      {trendingKeywords.length > 0 && (
        <div className="glass-card border-orange-500/20">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <Flame size={16} className="text-orange-400" /> 急上昇トレンド（前週比）
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {trendingKeywords.map(kw => {
              const isUp = kw.delta > 0;
              const isFlat = kw.delta === 0;
              return (
                <div key={kw.keyword} className={`p-3 rounded-xl border flex flex-col gap-1 ${
                  isUp ? 'bg-orange-500/10 border-orange-500/20' :
                  isFlat ? 'bg-white/5 border-white/10' :
                  'bg-slate-500/10 border-slate-500/20'
                }`}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-white truncate" title={kw.keyword}>{kw.keyword}</span>
                    {isUp ? <ArrowUpRight size={13} className="text-orange-400 flex-shrink-0" /> :
                     isFlat ? <Minus size={13} className="text-slate-500 flex-shrink-0" /> :
                     <ArrowDownRight size={13} className="text-slate-500 flex-shrink-0" />}
                  </div>
                  <span className={`text-lg font-bold font-outfit ${isUp ? 'text-orange-400' : 'text-slate-400'}`}>
                    {kw.thisWeek}件
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {isUp ? `+${kw.delta}` : kw.delta === 0 ? '±0' : kw.delta} vs 前週
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isLoadingData
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonStat key={i} />)
          : stats.map((stat, idx) => (
            <div key={idx} className="glass-card">
              <div className={`p-2 rounded-lg bg-white/5 ${stat.color} inline-flex mb-3`}>{stat.icon}</div>
              <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">{stat.label}</p>
              <h3 className="text-2xl md:text-3xl font-bold font-outfit">{stat.value}</h3>
            </div>
          ))
        }
      </div>

      {/* Row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 glass-card h-[220px] md:h-[260px]">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <BarChart3 size={16} className="text-sky-400" /> 収集アクティビティ（直近7日）
          </h3>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={activityData}>
              <defs>
                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" stroke="#475569" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="count" name="収集件数" stroke="#38bdf8" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCount)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card h-[220px] md:h-[260px]">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <Database size={16} className="text-purple-400" /> ソース健全性
          </h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
              <RechartsBar dataKey="value" name="件数" fill="#818cf8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 glass-card h-[220px] md:h-[260px]">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <TrendingUp size={16} className="text-emerald-400" /> カテゴリ別トレンド（直近7日）
          </h3>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={categoryTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
              {CATEGORY_LIST.map(cat => (
                <Area key={cat} type="monotone" dataKey={cat} stackId="1" stroke={CATEGORY_COLORS[cat]} fill={CATEGORY_COLORS[cat]} fillOpacity={0.6} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card h-[220px] md:h-[260px]">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <Brain size={16} className="text-pink-400" /> モデル言及頻度（30日）
          </h3>
          {modelMentionData.length > 0 ? (
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={modelMentionData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="model" stroke="#475569" fontSize={11} tickLine={false} axisLine={false} width={65} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                <RechartsBar dataKey="count" name="言及数" fill="#f472b6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-[80%] text-slate-500 text-xs text-center gap-1">
              <span>データなし</span>
              <span>30日分蓄積後に表示</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
