"use client";

import { useState } from 'react';
import { Telescope, Bell, X, Sparkles, Search, Sunrise, ExternalLink, Lightbulb } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Markdown } from '@/components/Markdown';
import { SkeletonStat } from '@/components/Skeleton';
import { generateResearchBrief, dismissAlert } from '@/app/actions';
import type { BriefingReport, AlertItem, ResearchBrief } from '@/types';

const SEVERITY_META: Record<string, { mark: string; color: string; bg: string; border: string }> = {
  high:  { mark: '🔴', color: '#f87171', bg: 'rgba(248,113,113,0.07)', border: 'rgba(248,113,113,0.2)' },
  watch: { mark: '🟡', color: '#fbbf24', bg: 'rgba(251,191,36,0.07)', border: 'rgba(251,191,36,0.2)' },
  info:  { mark: '🔵', color: '#38bdf8', bg: 'rgba(56,189,248,0.07)', border: 'rgba(56,189,248,0.2)' },
};

interface ResearchTabProps {
  briefing: BriefingReport | null;
  crossInsight?: BriefingReport | null;
  alerts: AlertItem[];
  isLoadingData: boolean;
  onReload: () => Promise<void>;
}

export function ResearchTab({ briefing, crossInsight = null, alerts, isLoadingData, onReload }: ResearchTabProps) {
  const { toast } = useToast();
  const [topic, setTopic] = useState('');
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    const t = topic.trim();
    if (!t || generating) return;
    setGenerating(true);
    setBrief(null);
    try {
      const result = await generateResearchBrief(t);
      if (result) {
        setBrief(result);
      } else {
        toast('ブリーフ生成に失敗しました', 'error');
      }
    } catch {
      toast('通信エラーが発生しました', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleDismiss = async (id: number) => {
    await dismissAlert(id);
    await onReload();
  };

  return (
    <div className="space-y-8">

      {/* 今週の横断インサイト */}
      {crossInsight?.content && (
        <div className="glass-card border-purple-500/20">
          <div className="flex justify-between items-center mb-3 border-b border-white/5 pb-2">
            <span className="font-mono text-[10px] text-purple-300 tracking-wider uppercase flex items-center gap-1.5">
              <Lightbulb size={13} /> 今週の横断インサイト
            </span>
            <span className="text-xs text-slate-400 bg-white/5 px-2 py-0.5 rounded-full">{crossInsight.reportDate}</span>
          </div>
          <Markdown content={crossInsight.content} />
        </div>
      )}

      {/* 先読みアラート */}
      <div>
        <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
          <Bell size={16} className="text-amber-400" /> 先読みアラート
        </h3>
        {isLoadingData ? (
          <SkeletonStat />
        ) : alerts.length === 0 ? (
          <div className="glass-card flex items-center justify-center py-8 text-slate-500 text-xs">
            現在アラートはありません
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {alerts.map(a => {
              const sev = SEVERITY_META[a.severity ?? 'watch'] ?? SEVERITY_META.watch;
              return (
                <div key={a.id} className="rounded-xl border p-3 flex items-start gap-3"
                  style={{ background: sev.bg, borderColor: sev.border }}>
                  <span className="text-sm flex-shrink-0 mt-0.5">{sev.mark}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{a.title}</p>
                    <p className="text-xs text-slate-400 leading-relaxed mt-0.5">{a.reason}</p>
                  </div>
                  <button onClick={() => handleDismiss(a.id)} title="閉じる"
                    className="p-1 rounded-md hover:bg-white/10 text-slate-600 hover:text-white transition-colors flex-shrink-0">
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 朝のブリーフィング */}
      <div>
        <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
          <Sunrise size={16} className="text-orange-400" /> 朝のブリーフィング
        </h3>
        {isLoadingData ? (
          <SkeletonStat />
        ) : briefing?.content ? (
          <div className="glass-card border-orange-500/20">
            <div className="flex justify-between items-center mb-3 border-b border-white/5 pb-2">
              <span className="font-mono text-[10px] text-orange-300 tracking-wider uppercase">夜間自律リサーチの成果</span>
              <span className="text-xs text-slate-400 bg-white/5 px-2 py-0.5 rounded-full">{briefing.reportDate}</span>
            </div>
            <Markdown content={briefing.content} />
          </div>
        ) : (
          <div className="glass-card flex flex-col items-center justify-center py-8 text-slate-500 text-xs gap-1">
            <span>ブリーフィングはまだ生成されていません</span>
            <span>パイプライン実行後の朝に表示されます</span>
          </div>
        )}
      </div>

      {/* オンデマンドリサーチブリーフ */}
      <div>
        <h3 className="text-sm font-bold font-outfit mb-3 flex items-center gap-2">
          <Telescope size={16} className="text-indigo-400" /> オンデマンドリサーチブリーフ
        </h3>
        <div className="glass-card">
          <div className="flex gap-2 mb-1">
            <div className="flex-1 flex items-center gap-2 bg-white/5 rounded-xl px-3 border border-white/10 focus-within:border-sky-500/40 transition-colors">
              <Search size={15} className="text-slate-500 flex-shrink-0" />
              <input
                value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleGenerate(); }}
                placeholder="例: RAG / Mixture of Experts / AIエージェントの評価手法"
                className="flex-1 bg-transparent py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating || !topic.trim()}
              className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm shadow-lg shadow-indigo-500/20 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles size={14} className={generating ? 'animate-spin' : ''} />
              {generating ? '調査中...' : '生成'}
            </button>
          </div>
          <p className="font-mono text-[10px] text-slate-600 px-1">定義 / 現状 / 主要プレイヤー / 直近の動向 / 未解決の課題 / 関連読書 を構造化出力（Web検索＋DB横断）</p>

          {brief && (
            <div className="mt-4 pt-4 border-t border-white/5">
              <Markdown content={brief.content} />
              {brief.relatedArticles.length > 0 && (
                <div className="mt-4 pt-3 border-t border-white/5">
                  <p className="font-mono text-[10px] text-slate-500 mb-2 uppercase tracking-wider">DB内の関連記事</p>
                  <div className="flex flex-col gap-1">
                    {brief.relatedArticles.map((r, i) => (
                      <a key={i} href={r.url ?? '#'} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-400 transition-colors">
                        <ExternalLink size={11} className="flex-shrink-0" />
                        <span className="truncate">{r.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
