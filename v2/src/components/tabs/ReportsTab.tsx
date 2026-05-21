"use client";

import React, { useState } from 'react';
import { FileText, Sparkles, Activity, Download } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { renderMarkdown } from '@/components/Markdown';
import type { Report } from '@/types';

interface ReportsTabProps {
  reportsList: Report[];
  isLoadingData: boolean;
  collectedItemsCount: number;
  onReload: () => Promise<void>;
}

function downloadMarkdown(report: Report) {
  const typeLabel = report.type === 'weekly' ? '週次' : report.type === 'monthly' ? '月次' : '日次';
  const filename = `AIResearcher_${typeLabel}_${report.reportDate}.md`;
  const blob = new Blob([report.content ?? ''], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsTab({ reportsList, isLoadingData, collectedItemsCount, onReload }: ReportsTabProps) {
  const { toast } = useToast();
  const [reportTypeFilter, setReportTypeFilter] = useState<'all' | 'daily' | 'weekly' | 'monthly'>('all');
  const [generating, setGenerating] = useState<Record<string, boolean>>({});

  const handleGenerate = async (type: 'daily' | 'weekly' | 'monthly') => {
    if (generating[type]) return;
    const urls: Record<string, string> = { daily: '/api/report', weekly: '/api/report/weekly', monthly: '/api/report/monthly' };
    const labels: Record<string, string> = { daily: '日次', weekly: '週次', monthly: '月次' };
    setGenerating(prev => ({ ...prev, [type]: true }));
    try {
      const res = await fetch(urls[type], { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        await onReload();
        setReportTypeFilter(type);
        toast(`${labels[type]}レポートを生成しました`, 'success');
      } else {
        toast(`${labels[type]}レポート生成エラー: ${result.message ?? '不明なエラー'}`, 'error');
      }
    } catch {
      toast('通信エラーが発生しました', 'error');
    } finally {
      setGenerating(prev => ({ ...prev, [type]: false }));
    }
  };

  const filtered = reportsList.filter(r => reportTypeFilter === 'all' || r.type === reportTypeFilter);

  const buttons = [
    { label: '日次', type: 'daily' as const, color: 'from-emerald-500 to-teal-500 shadow-emerald-500/20' },
    { label: '週次', type: 'weekly' as const, color: 'from-sky-500 to-blue-500 shadow-sky-500/20' },
    { label: '月次', type: 'monthly' as const, color: 'from-purple-500 to-violet-500 shadow-purple-500/20' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex gap-2">
          {(['all', 'daily', 'weekly', 'monthly'] as const).map(t => (
            <button key={t} onClick={() => setReportTypeFilter(t)}
              className={`px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${reportTypeFilter === t ? 'bg-sky-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>
              {t === 'all' ? '全て' : t === 'daily' ? '日次' : t === 'weekly' ? '週次' : '月次'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {buttons.map(btn => (
            <button
              key={btn.type}
              onClick={() => handleGenerate(btn.type)}
              disabled={generating[btn.type] || collectedItemsCount === 0}
              className={`bg-gradient-to-r ${btn.color} text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm shadow-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <Sparkles size={14} className={generating[btn.type] ? 'animate-spin' : ''} />
              {generating[btn.type] ? '生成中...' : btn.label}
            </button>
          ))}
        </div>
      </div>

      {isLoadingData ? (
        <div className="flex justify-center items-center py-20 text-emerald-400">
          <Activity className="animate-pulse" size={32} />
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-8">
          {filtered.map(report => (
            <div key={report.id} className="glass-card border-emerald-500/20 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none select-none">
                <FileText size={120} />
              </div>
              <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2 flex-wrap">
                  <span className="text-emerald-400">■</span>
                  {report.type === 'weekly' ? '週次レポート' : report.type === 'monthly' ? '月次レポート' : 'デイリーレポート'}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                    report.type === 'weekly' ? 'bg-sky-500/20 text-sky-400' :
                    report.type === 'monthly' ? 'bg-purple-500/20 text-purple-400' :
                    'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    {report.type}
                  </span>
                </h3>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm text-slate-400 bg-white/5 px-3 py-1 rounded-full">{report.reportDate}</span>
                  <button
                    onClick={() => downloadMarkdown(report)}
                    title="Markdownでエクスポート"
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                  >
                    <Download size={14} />
                  </button>
                </div>
              </div>
              <div>{renderMarkdown(report.content ?? '')}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-slate-400 text-center py-20 glass-card">
          <FileText size={48} className="mx-auto mb-4 opacity-20" />
          <p className="mb-2">レポートはまだ生成されていません。</p>
          <p className="text-xs text-slate-500">上のボタンをクリックしてレポートを生成してください。</p>
        </div>
      )}
    </div>
  );
}
