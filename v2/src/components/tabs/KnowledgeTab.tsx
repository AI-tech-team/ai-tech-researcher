"use client";

import { Trophy, Network, AlertTriangle, GitBranch, Sparkles } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { SkeletonStat } from '@/components/Skeleton';
import type { BenchmarkLeaderboard, KnowledgeRelation, BenchmarkAlert, KnowledgeStats } from '@/types';

const ENTITY_COLORS = ['#38bdf8', '#f472b6', '#34d399', '#fb923c', '#a78bfa'];

const RELATION_META: Record<string, { label: string; color: string }> = {
  outperforms:   { label: '上回る',   color: '#f87171' },
  competes_with: { label: '競合',     color: '#38bdf8' },
  builds_on:     { label: '基づく',   color: '#34d399' },
  acquired_by:   { label: '買収',     color: '#a78bfa' },
  cites:         { label: '引用',     color: '#94a3b8' },
  supersedes:    { label: '置換',     color: '#f472b6' },
};

const TOOLTIP_STYLE = {
  contentStyle: { background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '12px' },
};

const RANK_MEDAL = ['🥇', '🥈', '🥉'];

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
        <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
          <Trophy size={16} className="text-amber-400" /> ベンチマークリーダーボード
        </h3>
        {isLoadingData ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => <SkeletonStat key={i} />)}
          </div>
        ) : leaderboards.length === 0 ? (
          <div className="glass-card flex flex-col items-center justify-center py-10 text-slate-500 text-xs gap-1">
            <span>ベンチマークデータが2エンティティ以上揃うと表示されます</span>
            <span>パイプライン蓄積で自動的に充実します</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {leaderboards.map(lb => (
              <div key={lb.benchmarkName} className="glass-card">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-amber-300 truncate" title={lb.benchmarkName}>{lb.benchmarkName}</h4>
                  {lb.unit && <span className="font-mono text-[10px] text-slate-500">{lb.unit}</span>}
                </div>

                {/* ランキング */}
                <div className="flex flex-col gap-1.5 mb-3">
                  {lb.entries.slice(0, 6).map((e, i) => (
                    <div key={e.entityName} className="flex items-center gap-2">
                      <span className="w-5 text-center text-xs flex-shrink-0">{RANK_MEDAL[i] ?? <span className="text-slate-600 font-mono text-[10px]">{i + 1}</span>}</span>
                      <span className="text-xs text-slate-200 truncate flex-1" title={e.entityName}>
                        {e.sourceUrl
                          ? <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-sky-400 transition-colors">{e.entityName}</a>
                          : e.entityName}
                      </span>
                      <span className="font-mono text-xs font-bold text-white flex-shrink-0">{e.score}</span>
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

      {/* Knowledge graph relations */}
      <div>
        <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
          <Network size={16} className="text-indigo-400" /> 知識グラフ（エンティティ関係）
        </h3>
        {isLoadingData ? (
          <SkeletonStat />
        ) : activeRelations.length === 0 && staleRelations.length === 0 ? (
          <div className="glass-card flex items-center justify-center py-10 text-slate-500 text-xs">
            関係データはまだありません
          </div>
        ) : (
          <div className="glass-card">
            <div className="flex flex-col gap-1.5">
              {activeRelations.map(r => {
                const meta = RELATION_META[r.relationType] ?? { label: r.relationType, color: '#94a3b8' };
                const isInferred = r.status === 'inferred';
                return (
                  <div key={r.id} className="flex items-center gap-2 flex-wrap text-xs py-1 border-b border-white/[0.03] last:border-0">
                    <span className="text-slate-200 font-medium">{r.subjectName}</span>
                    <span className="flex items-center gap-1">
                      <GitBranch size={11} style={{ color: meta.color }} className="rotate-90" />
                      <span className="font-mono text-[10px] px-1.5 py-px rounded border"
                        style={{ color: meta.color, borderColor: `${meta.color}33`, background: `${meta.color}11` }}>
                        {meta.label}
                      </span>
                    </span>
                    <span className="text-slate-200 font-medium">{r.objectName}</span>
                    {isInferred && (
                      <span className="flex items-center gap-0.5 font-mono text-[9px] text-purple-300 border border-purple-500/20 bg-purple-500/10 px-1.5 py-px rounded">
                        <Sparkles size={9} /> 推論
                      </span>
                    )}
                    {r.validFrom && <span className="ml-auto font-mono text-[10px] text-slate-600">{r.validFrom}</span>}
                  </div>
                );
              })}
            </div>

            {/* stale（陳腐化した関係） */}
            {staleRelations.length > 0 && (
              <details className="mt-3">
                <summary className="font-mono text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">
                  陳腐化した関係 {staleRelations.length}件を表示
                </summary>
                <div className="flex flex-col gap-1 mt-2">
                  {staleRelations.map(r => {
                    const meta = RELATION_META[r.relationType] ?? { label: r.relationType, color: '#94a3b8' };
                    return (
                      <div key={r.id} className="flex items-center gap-2 flex-wrap text-xs py-0.5 opacity-50 line-through">
                        <span className="text-slate-400">{r.subjectName}</span>
                        <span className="font-mono text-[10px]" style={{ color: meta.color }}>{meta.label}</span>
                        <span className="text-slate-400">{r.objectName}</span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
