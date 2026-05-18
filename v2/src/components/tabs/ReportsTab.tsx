"use client";

import React, { Fragment, useState } from 'react';
import { FileText, Sparkles, Activity, Download } from 'lucide-react';
import { useToast } from '@/components/Toast';
import type { Report } from '@/types';

// インライン要素のMarkdownパーサー
function parseInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const m = match[0];
    if (m.startsWith('**'))
      parts.push(<strong key={key++} className="text-white font-semibold">{m.slice(2, -2)}</strong>);
    else if (m.startsWith('*'))
      parts.push(<em key={key++} className="text-slate-300 italic">{m.slice(1, -1)}</em>);
    else if (m.startsWith('`'))
      parts.push(<code key={key++} className="bg-white/10 text-sky-300 px-1.5 py-0.5 rounded text-xs font-mono">{m.slice(1, -1)}</code>);
    lastIndex = match.index + m.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length === 1 ? parts[0] : <Fragment>{parts}</Fragment>;
}

// MarkdownをJSX Nodeのリストに変換
function renderMarkdown(content: string): React.ReactNode[] {
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  const listItems: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = [...listItems];
    if (listType === 'ul') {
      nodes.push(<ul key={`ul-${nodes.length}`} className="ml-2 mb-3 space-y-1.5 list-none">{items}</ul>);
    } else {
      nodes.push(<ol key={`ol-${nodes.length}`} className="ml-2 mb-3 space-y-1.5 list-none">{items}</ol>);
    }
    listItems.length = 0;
    listType = null;
  };

  lines.forEach((line, i) => {
    if (line.startsWith('### ')) {
      flushList();
      nodes.push(<h4 key={i} className="text-base font-bold text-white mt-5 mb-2">{parseInline(line.slice(4))}</h4>);
    } else if (line.startsWith('## ')) {
      flushList();
      nodes.push(<h3 key={i} className="text-lg font-bold text-sky-400 mt-7 mb-3">{parseInline(line.slice(3))}</h3>);
    } else if (line.startsWith('# ')) {
      flushList();
      nodes.push(<h2 key={i} className="text-xl font-bold text-emerald-400 mt-8 mb-4">{parseInline(line.slice(2))}</h2>);
    } else if (/^[-*] /.test(line)) {
      listType = 'ul';
      listItems.push(
        <li key={i} className="flex gap-2 text-slate-300 text-sm">
          <span className="text-sky-400/60 flex-shrink-0 mt-0.5 select-none">•</span>
          <span>{parseInline(line.slice(2))}</span>
        </li>
      );
    } else if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\./)?.[1] ?? '';
      listType = 'ol';
      listItems.push(
        <li key={i} className="flex gap-2 text-slate-300 text-sm">
          <span className="text-sky-400 flex-shrink-0 font-mono text-xs mt-0.5 w-5">{num}.</span>
          <span>{parseInline(line.replace(/^\d+\. /, ''))}</span>
        </li>
      );
    } else if (line.startsWith('> ')) {
      flushList();
      nodes.push(
        <blockquote key={i} className="border-l-2 border-purple-500/40 pl-4 italic text-slate-400 text-sm my-2">
          {parseInline(line.slice(2))}
        </blockquote>
      );
    } else if (/^[-*]{3,}$/.test(line) || /^={3,}$/.test(line)) {
      flushList();
      nodes.push(<hr key={i} className="border-white/10 my-4" />);
    } else if (!line.trim()) {
      flushList();
      nodes.push(<div key={i} className="h-1.5" />);
    } else {
      flushList();
      nodes.push(<p key={i} className="text-slate-300 text-sm mb-2 leading-relaxed">{parseInline(line)}</p>);
    }
  });
  flushList();
  return nodes;
}

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
