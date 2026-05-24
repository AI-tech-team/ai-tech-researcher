"use client";

import { TrendingUp, Globe, FileText, Star, BarChart3, Brain, Flame, ArrowUpRight, ArrowDownRight, Minus, Layers, ExternalLink, Rss, Hash, Cpu } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar as RechartsBar,
} from 'recharts';
import { SkeletonStat } from '@/components/Skeleton';
import { useMounted } from '@/lib/useMounted';
import type { CollectedItem, Source, Report, TrendingKeyword, TopicCluster } from '@/types';

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
  labelStyle: { color: '#cbd5e1' },
};

// ソース種別ごとのアイコン
function sourceIcon(type: string) {
  if (type === 'keyword') return <Hash size={12} className="text-sky-400" />;
  if (type.includes('github')) return <Star size={12} className="text-slate-300" />;
  if (type === 'hn' || type === 'arxiv' || type === 'url') return <Cpu size={12} className="text-emerald-400" />;
  return <Rss size={12} className="text-orange-400" />;
}

// フィードURL/値を短い表示名に
function sourceLabel(s: Source): string {
  const v = s.value ?? '';
  if (s.type === 'keyword') return v;
  try { return new URL(v).hostname.replace(/^www\./, ''); } catch { return v.replace(/^https?:\/\//, '').slice(0, 40); }
}

interface OverviewTabProps {
  sourcesList: Source[];
  collectedItems: CollectedItem[];
  reportsList: Report[];
  activityData: { name: string; count: number }[];
  categoryTrendData: any[];
  modelMentionData: { model: string; count: number }[];
  trendingKeywords: TrendingKeyword[];
  topicClusters?: TopicCluster[];
  isLoadingData: boolean;
}

export function OverviewTab({
  sourcesList, collectedItems, reportsList, activityData,
  categoryTrendData, modelMentionData, trendingKeywords, topicClusters = [], isLoadingData,
}: OverviewTabProps) {
  const mounted = useMounted();
  const activeSources = sourcesList.filter(s => s.status === 'active').sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const stats = [
    { label: '有効な情報源', value: activeSources.length, color: 'text-sky-400', icon: <Rss size={18} /> },
    { label: '収集データ', value: collectedItems.length, color: 'text-purple-400', icon: <Globe size={18} /> },
    { label: '生成レポート', value: reportsList.length, color: 'text-emerald-400', icon: <FileText size={18} /> },
    { label: 'お気に入り', value: collectedItems.filter(i => i.isFavorited).length, color: 'text-amber-400', icon: <Star size={18} /> },
  ];

  return (
    <div className="space-y-6">

      {/* ── サマリー統計 ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isLoadingData
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonStat key={i} />)
          : stats.map((stat, idx) => (
            <div key={idx} className="glass-card !p-4 flex items-center gap-3">
              <div className={`p-2.5 rounded-xl bg-white/5 ${stat.color} flex-shrink-0`}>{stat.icon}</div>
              <div className="min-w-0">
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider truncate">{stat.label}</p>
                <h3 className="text-2xl font-bold font-outfit leading-tight">{stat.value}</h3>
              </div>
            </div>
          ))
        }
      </div>

      {/* ── 有効な情報源 ── */}
      <div className="glass-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold font-outfit flex items-center gap-2">
            <Rss size={16} className="text-sky-400" /> 有効な情報源
          </h3>
          <span className="font-mono text-[10px] text-emerald-400 border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 rounded">
            {activeSources.length} ACTIVE
          </span>
        </div>
        {activeSources.length === 0 ? (
          <p className="text-xs text-slate-500">稼働中の情報源がありません</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
            {activeSources.map(s => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/5 bg-white/[0.02]">
                <span className="flex-shrink-0">{sourceIcon(s.type)}</span>
                <span className="text-xs text-slate-300 truncate flex-1" title={s.value}>{sourceLabel(s)}</span>
                <span className="font-mono text-[10px] text-slate-600 flex-shrink-0">{(s.score ?? 0).toFixed(0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 収集アクティビティ ── */}
      <div className="glass-card h-[240px]">
        <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
          <BarChart3 size={16} className="text-sky-400" /> 収集アクティビティ（直近7日）
        </h3>
        {mounted && (
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
        )}
      </div>

      {/* ── カテゴリ別トレンド ＋ モデル言及頻度 ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 glass-card h-[240px]">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <TrendingUp size={16} className="text-emerald-400" /> カテゴリ別トレンド（直近7日）
          </h3>
          {mounted && (
            <ResponsiveContainer width="100%" height="85%">
              <AreaChart data={categoryTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="name" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...TOOLTIP_STYLE} />
                {CATEGORY_LIST.map(cat => (
                  <Area key={cat} type="monotone" dataKey={cat} stackId="1" stroke={CATEGORY_COLORS[cat]} fill={CATEGORY_COLORS[cat]} fillOpacity={0.6} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass-card h-[240px]">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <Brain size={16} className="text-pink-400" /> モデル言及頻度（30日）
          </h3>
          {modelMentionData.length > 0 ? (
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={modelMentionData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="model" stroke="#475569" fontSize={11} tickLine={false} axisLine={false} width={65} />
                <Tooltip {...TOOLTIP_STYLE} />
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

      {/* ── 急上昇トレンド ── */}
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

      {/* ── 今週の話題の塊 ── */}
      {topicClusters.length > 0 && (
        <div className="glass-card border-cyan-500/20">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <Layers size={16} className="text-cyan-400" /> 今週の話題の塊
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {topicClusters.map(c => (
              <div key={c.storyId} className="rounded-xl border border-cyan-500/10 bg-cyan-500/5 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-mono text-[10px] text-cyan-300 bg-cyan-500/15 px-1.5 py-0.5 rounded">{c.size}件</span>
                  {c.category && <span className="font-mono text-[10px] text-slate-500">{c.category}</span>}
                </div>
                <p className="text-sm font-semibold text-white leading-snug mb-1.5">{c.headline}</p>
                <div className="flex flex-col gap-0.5">
                  {c.members.slice(1, 4).map(m => (
                    <a key={m.id} href={m.url ?? '#'} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-300 transition-colors">
                      <ExternalLink size={9} className="flex-shrink-0" />
                      <span className="truncate">{m.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
