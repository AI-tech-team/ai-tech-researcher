"use client";

import { Trophy, Network, AlertTriangle, Sparkles, TrendingUp, TrendingDown, Minus, ExternalLink, Crown, ArrowRight } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { SkeletonStat } from '@/components/Skeleton';
import type { BenchmarkLeaderboard, KnowledgeRelation, BenchmarkAlert, KnowledgeStats } from '@/types';

const ENTITY_COLORS = ['#38bdf8', '#f472b6', '#34d399', '#fb923c', '#a78bfa'];

// 関係タイプ別のセクション定義（ユーザーが知りたい順）
const RELATION_GROUPS: { type: string; label: string; icon: string; color: string }[] = [
  { type: 'outperforms',   label: '性能で上回る', icon: '🏆', color: '#f87171' },
  { type: 'supersedes',    label: '置き換え',     icon: '🔄', color: '#f472b6' },
  { type: 'competes_with', label: '競合',         icon: '⚔️', color: '#38bdf8' },
  { type: 'builds_on',     label: '基づく',       icon: '🧱', color: '#34d399' },
  { type: 'acquired_by',   label: '買収',         icon: '🤝', color: '#a78bfa' },
  { type: 'cites',         label: '引用',         icon: '📎', color: '#94a3b8' },
];

const TOOLTIP_STYLE = {
  contentStyle: { background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '12px' },
};

const RANK_MEDAL = ['🥇', '🥈', '🥉'];

// 出典URLが安全（実URL・404リダイレクトでない）かを判定
const isValidSourceUrl = (u: string | null) => !!u && /^https?:\/\//.test(u) && !u.includes('vertexaisearch.cloud.google.com');

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' | 'new' }) {
  if (trend === 'up') return <TrendingUp size={12} className="text-emerald-400" />;
  if (trend === 'down') return <TrendingDown size={12} className="text-red-400" />;
  if (trend === 'new') return <span className="font-mono text-[9px] text-sky-400 font-bold">NEW</span>;
  return <Minus size={12} className="text-slate-600" />;
}

interface KnowledgeTabProps {
  leaderboards: BenchmarkLeaderboard[];
  relations: KnowledgeRelation[];
  alerts: BenchmarkAlert[];
  stats: KnowledgeStats;
  isLoadingData: boolean;
}

export function KnowledgeTab({ leaderboards, relations, alerts, stats, isLoadingData }: KnowledgeTabProps) {
  const statCards = [
    { label: 'エンティティ', value: stats.entities, color: 'text-sky-400' },
    { label: 'ベンチマーク記録', value: stats.benchmarks, color: 'text-amber-400' },
    { label: '関係エッジ', value: stats.relations, color: 'text-emerald-400' },
    { label: 'stale(陳腐化)', value: stats.staleRelations, color: 'text-slate-400' },
  ];

  const activeRelations = relations.filter(r => r.status !== 'stale');
  const staleRelations = relations.filter(r => r.status === 'stale');
  // 関係タイプ別にグルーピング
  const grouped = RELATION_GROUPS
    .map(g => ({ ...g, items: activeRelations.filter(r => r.relationType === g.type) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="space-y-8">

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isLoadingData
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonStat key={i} />)
          : statCards.map((s, i) => (
            <div key={i} className="glass-card">
              <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">{s.label}</p>
              <h3 className={`text-2xl md:text-3xl font-bold font-outfit ${s.color}`}>{s.value}</h3>
            </div>
          ))
        }
      </div>

      {/* Lead-change alerts */}
      {alerts.length > 0 && (
        <div className="glass-card border-red-500/20">
          <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-400" /> リーダー交代アラート
          </h3>
          <div className="flex flex-col gap-2">
            {alerts.map((a, i) => (
              <div key={i} className="rounded-xl border border-red-500/10 bg-red-500/5 p-3 flex items-center gap-2 flex-wrap text-xs">
                <span className="font-mono text-[10px] text-red-400 font-bold uppercase tracking-wider">{a.benchmarkName}</span>
                <span className="text-white font-semibold">{a.newLeader}</span>
                <span className="text-slate-400">が</span>
                <span className="text-slate-400 line-through">{a.prevLeader}</span>
                <span className="text-slate-400">を上回った</span>
                <span className="ml-auto font-mono text-[11px] text-red-300">{a.prevScore} → {a.newScore}</span>
                {a.date && <span className="font-mono text-[10px] text-slate-600">{a.date}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Benchmark leaderboards */}
      <div>
        <h3 className="text-sm font-bold font-outfit mb-1 flex items-center gap-2">
          <Trophy size={16} className="text-amber-400" /> ベンチマークリーダーボード
        </h3>
        <p className="text-[11px] text-slate-500 mb-3">同一ベンチマークで複数モデルのスコアが集まると自動でランキング化されます</p>
        {isLoadingData ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => <SkeletonStat key={i} />)}
          </div>
        ) : leaderboards.length === 0 ? (
          <div className="glass-card flex flex-col items-center justify-center py-10 text-slate-500 text-xs gap-1">
            <Trophy size={28} className="opacity-20 mb-1" />
            <span>まだランキングできるベンチマークがありません</span>
            <span>収集が進むと自動的に充実します</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {leaderboards.map(lb => (
              <div key={lb.benchmarkName} className="glass-card border-amber-500/10">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-amber-300 truncate" title={lb.benchmarkName}>{lb.benchmarkName}</h4>
                  <span className="font-mono text-[10px] text-slate-500">{lb.entries.length}モデル{lb.unit ? ` ・ ${lb.unit}` : ''}</span>
                </div>

                {/* ランキング（モデル名は非リンク。出典は安全なURLのみ） */}
                <div className="flex flex-col gap-1 mb-3">
                  {lb.entries.slice(0, 6).map((e, i) => (
                    <div key={e.entityName}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${i === 0 ? 'bg-amber-500/10 border border-amber-500/20' : ''}`}>
                      <span className="w-5 text-center text-xs flex-shrink-0">
                        {RANK_MEDAL[i] ?? <span className="text-slate-600 font-mono text-[10px]">{i + 1}</span>}
                      </span>
                      {i === 0 && <Crown size={12} className="text-amber-400 flex-shrink-0" />}
                      <span className={`text-xs truncate flex-1 ${i === 0 ? 'text-white font-bold' : 'text-slate-200'}`} title={e.entityName}>
                        {e.entityName}
                      </span>
                      <TrendIcon trend={e.trend} />
                      <span className={`font-mono text-xs flex-shrink-0 ${i === 0 ? 'text-amber-300 font-bold' : 'text-slate-300'}`}>{e.score}</span>
                      {isValidSourceUrl(e.sourceUrl) && (
                        <a href={e.sourceUrl!} target="_blank" rel="noopener noreferrer" title="出典"
                          className="text-slate-600 hover:text-sky-400 transition-colors flex-shrink-0">
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>

                {/* 時系列グラフ（2点以上ある場合） */}
                {lb.series.length >= 2 && (
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={lb.series} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="date" stroke="#475569" fontSize={9} tickLine={false} axisLine={false} />
                      <YAxis stroke="#475569" fontSize={9} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                      <Tooltip {...TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: '9px' }} iconSize={8} />
                      {lb.topEntities.map((ent, idx) => (
                        <Line key={ent} type="monotone" dataKey={ent} stroke={ENTITY_COLORS[idx % ENTITY_COLORS.length]}
                          strokeWidth={2} dot={{ r: 2 }} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Knowledge graph — 関係タイプ別 */}
      <div>
        <h3 className="text-sm font-bold font-outfit mb-1 flex items-center gap-2">
          <Network size={16} className="text-indigo-400" /> 知識グラフ（関係マップ）
        </h3>
        <p className="text-[11px] text-slate-500 mb-3">記事から抽出したエンティティ間の関係。AI業界の勢力図を俯瞰できます</p>
        {isLoadingData ? (
          <SkeletonStat />
        ) : grouped.length === 0 && staleRelations.length === 0 ? (
          <div className="glass-card flex items-center justify-center py-10 text-slate-500 text-xs">
            関係データはまだありません
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {grouped.map(g => (
              <div key={g.type} className="glass-card" style={{ borderColor: `${g.color}22` }}>
                <h4 className="text-xs font-bold mb-2.5 flex items-center gap-1.5" style={{ color: g.color }}>
                  <span>{g.icon}</span>{g.label}
                  <span className="font-mono text-[10px] text-slate-600">{g.items.length}</span>
                </h4>
                <div className="flex flex-col gap-1.5">
                  {g.items.slice(0, 12).map(r => (
                    <div key={r.id} className="flex items-center gap-1.5 text-xs">
                      <span className="text-slate-200 font-medium truncate max-w-[42%]" title={r.subjectName}>{r.subjectName}</span>
                      <ArrowRight size={12} style={{ color: g.color }} className="flex-shrink-0" />
                      <span className="text-slate-300 truncate max-w-[42%]" title={r.objectName}>{r.objectName}</span>
                      {r.status === 'inferred' && (
                        <span className="flex items-center gap-0.5 font-mono text-[9px] text-purple-300 border border-purple-500/20 bg-purple-500/10 px-1 rounded flex-shrink-0">
                          <Sparkles size={8} />推論
                        </span>
                      )}
                    </div>
                  ))}
                  {g.items.length > 12 && (
                    <span className="font-mono text-[10px] text-slate-600">他 {g.items.length - 12} 件</span>
                  )}
                </div>
              </div>
            ))}

            {/* stale（陳腐化した関係） */}
            {staleRelations.length > 0 && (
              <details className="glass-card md:col-span-2">
                <summary className="font-mono text-[11px] text-slate-500 cursor-pointer hover:text-slate-300">
                  陳腐化した関係 {staleRelations.length}件
                </summary>
                <div className="flex flex-col gap-1 mt-2">
                  {staleRelations.map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-xs py-0.5 opacity-50 line-through">
                      <span className="text-slate-400">{r.subjectName}</span>
                      <ArrowRight size={11} className="text-slate-600" />
                      <span className="text-slate-400">{r.objectName}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
