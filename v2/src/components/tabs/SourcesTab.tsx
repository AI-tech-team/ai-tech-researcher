"use client";

import { useState } from 'react';
import { Plus, Trash2, RefreshCw, Hash, Globe } from 'lucide-react';
import { SkeletonRow } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import type { Source } from '@/types';

function getStatusColor(status: string) {
  switch (status) {
    case 'active': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'candidate': return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
    case 'low-priority': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  }
}

const scoreToPercent = (score: number) => Math.min(100, Math.max(0, (score + 20) * 2.5));

interface SourcesTabProps {
  sourcesList: Source[];
  isLoadingData: boolean;
  onAddSource: (keyword: string) => Promise<void>;
  onDeleteSource: (id: number) => Promise<void>;
  onEvolve: () => Promise<void>;
}

export function SourcesTab({ sourcesList, isLoadingData, onAddSource, onDeleteSource, onEvolve }: SourcesTabProps) {
  const { toast } = useToast();
  const [newKeyword, setNewKeyword] = useState('');
  const [isEvolving, setIsEvolving] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newKeyword.trim();
    if (!trimmed || isAdding) return;
    setIsAdding(true);
    try {
      await onAddSource(trimmed);
      setNewKeyword('');
      toast('キーワードを追加しました', 'success');
    } catch {
      toast('追加に失敗しました', 'error');
    } finally {
      setIsAdding(false);
    }
  };

  const handleEvolve = async () => {
    if (isEvolving) return;
    setIsEvolving(true);
    try {
      await onEvolve();
      toast('ソース自動進化が完了しました', 'success');
    } catch (err: any) {
      toast(`進化処理に失敗しました: ${err?.message ?? ''}`, 'error');
    } finally {
      setIsEvolving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await onDeleteSource(id);
      toast('削除しました', 'info');
    } catch {
      toast('削除に失敗しました', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <form onSubmit={handleAddKeyword} className="flex gap-2 flex-1">
          <input
            value={newKeyword}
            onChange={e => setNewKeyword(e.target.value)}
            placeholder="新規キーワードを追加..."
            maxLength={100}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-sm text-white focus:outline-none focus:border-sky-500/50 transition-colors"
          />
          <button
            type="submit"
            disabled={isAdding || !newKeyword.trim()}
            className="btn-primary flex items-center gap-2 px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={16} /> 追加
          </button>
        </form>
        <button
          onClick={handleEvolve}
          disabled={isEvolving}
          className="flex items-center gap-2 bg-purple-500/20 border border-purple-500/30 text-purple-300 px-4 py-2 rounded-xl text-sm font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={isEvolving ? 'animate-spin' : ''} />
          {isEvolving ? '進化中...' : 'ソース自動進化'}
        </button>
      </div>

      <div className="glass-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400 uppercase bg-white/5 border-b border-white/5">
              <tr>
                <th className="px-6 py-3">種別</th>
                <th className="px-6 py-3">値</th>
                <th className="px-6 py-3">ステータス</th>
                <th className="px-6 py-3">スコア</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoadingData
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                : sourcesList.map(source => (
                  <tr key={source.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-6 py-3.5">
                      <span className="flex items-center gap-2 text-slate-300">
                        {source.type === 'keyword'
                          ? <Hash size={14} className="text-sky-400" />
                          : <Globe size={14} className="text-emerald-400" />}
                        {source.type}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 font-medium text-white">{source.value}</td>
                    <td className="px-6 py-3.5">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold border ${getStatusColor(source.status)}`}>
                        {source.status}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-sky-400 to-purple-500"
                            style={{ width: `${scoreToPercent(source.score ?? 0)}%` }}
                          />
                        </div>
                        <span className="text-slate-400 font-mono text-xs">{(source.score ?? 0).toFixed(1)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      <button
                        onClick={() => handleDelete(source.id)}
                        className="text-slate-600 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-500/10"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
