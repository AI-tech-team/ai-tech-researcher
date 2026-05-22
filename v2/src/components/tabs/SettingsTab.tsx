"use client";

import { useState } from 'react';
import { Plus, Trash2, Hash, Globe, Zap, Tag, Cpu } from 'lucide-react';
import { SkeletonRow } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import type { Source } from '@/types';

const STATUS_STYLE: Record<string, string> = {
  active:        'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  candidate:     'text-sky-400    border-sky-500/30    bg-sky-500/10',
  'low-priority':'text-amber-400  border-amber-500/30  bg-amber-500/10',
  stopped:       'text-slate-500  border-slate-600/30  bg-slate-600/10',
};

interface SettingsTabProps {
  sourcesList: Source[];
  isLoadingData: boolean;
  interestTags: string[];
  onInterestTagsChange: (tags: string[]) => void;
  onAddSource: (keyword: string) => Promise<void>;
  onDeleteSource: (id: number) => Promise<void>;
  onEvolve: () => Promise<void>;
  onReload: () => Promise<void>;
}

type RunState = 'idle' | 'running' | 'done' | 'error';

// Tailwindは動的クラス名(border-${color}-500)を生成しないため、完全な文字列で持つ
const COLOR_CLS: Record<string, string> = {
  sky:     'border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10 hover:border-sky-500/30',
  purple:  'border-purple-500/20 bg-purple-500/5 hover:bg-purple-500/10 hover:border-purple-500/30',
  emerald: 'border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500/30',
};

export function SettingsTab({
  sourcesList, isLoadingData, interestTags, onInterestTagsChange,
  onAddSource, onDeleteSource, onEvolve, onReload,
}: SettingsTabProps) {
  const { toast } = useToast();
  const [newKeyword, setNewKeyword] = useState('');
  const [newTag, setNewTag] = useState('');
  const [collectState, setCollectState] = useState<RunState>('idle');
  const [evolveState, setEvolveState] = useState<RunState>('idle');
  const [recatState, setRecatState] = useState<RunState>('idle');
  const [isAdding, setIsAdding] = useState(false);

  /* ── Manual triggers ─────────────────────────────── */
  const runCollect = async () => {
    setCollectState('running');
    try {
      const res = await fetch('/api/collect', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast(data.message ?? '収集完了', 'success');
        await onReload();
        setCollectState('done');
      } else {
        toast(data.message ?? '収集失敗', 'error');
        setCollectState('error');
      }
    } catch {
      toast('通信エラー', 'error');
      setCollectState('error');
    }
  };

  const runEvolve = async () => {
    setEvolveState('running');
    try {
      await onEvolve();
      toast('ソース自動進化完了', 'success');
      setEvolveState('done');
    } catch (e: any) {
      toast(e?.message ?? '進化失敗', 'error');
      setEvolveState('error');
    }
  };

  const runRecat = async () => {
    setRecatState('running');
    try {
      const res = await fetch('/api/recategorize', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast(`再分類完了: ${data.updated ?? 0}件更新`, 'success');
        await onReload();
        setRecatState('done');
      } else {
        toast(data.message ?? '再分類失敗', 'error');
        setRecatState('error');
      }
    } catch {
      toast('通信エラー', 'error');
      setRecatState('error');
    }
  };

  /* ── Sources ─────────────────────────────────────── */
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

  /* ── Interest tags ───────────────────────────────── */
  const addTag = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = newTag.trim();
    if (!t || interestTags.includes(t)) return;
    const next = [...interestTags, t];
    onInterestTagsChange(next);
    localStorage.setItem('interestTags', JSON.stringify(next));
    setNewTag('');
  };

  const removeTag = (tag: string) => {
    const next = interestTags.filter(t => t !== tag);
    onInterestTagsChange(next);
    localStorage.setItem('interestTags', JSON.stringify(next));
  };

  const btnLabel = (s: RunState, idle: string) =>
    s === 'running' ? '実行中...' : s === 'done' ? '完了' : s === 'error' ? 'エラー' : idle;

  const activeCount    = sourcesList.filter(s => s.status === 'active').length;
  const candidateCount = sourcesList.filter(s => s.status === 'candidate').length;

  return (
    <div className="space-y-6">

      {/* ── Manual triggers ─────────────────────────── */}
      <section className="glass-card space-y-4">
        <h3 className="font-mono text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center gap-2">
          <Zap size={13} className="text-sky-400" /> 手動実行
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'データ収集', desc: 'ソースから1件収集', state: collectState, run: runCollect, color: 'sky' },
            { label: 'ソース自動進化', desc: 'ライフサイクル更新', state: evolveState, run: runEvolve, color: 'purple' },
            { label: 'カテゴリ再分類', desc: '未分類記事を再分類', state: recatState, run: runRecat, color: 'emerald' },
          ].map(({ label, desc, state, run, color }) => (
            <button key={label} onClick={run} disabled={state === 'running'}
              className={`flex flex-col items-start gap-1 p-4 rounded-xl border transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed
                ${state === 'done'  ? 'border-emerald-500/30 bg-emerald-500/5' :
                  state === 'error' ? 'border-red-500/30 bg-red-500/5' :
                  (COLOR_CLS[color] ?? COLOR_CLS.sky)}`}>
              <span className="font-mono text-xs font-bold text-slate-300">{btnLabel(state, label)}</span>
              <span className="font-mono text-[10px] text-slate-600">{desc}</span>
              {state === 'running' && <div className="w-full h-0.5 bg-slate-800 rounded mt-1 overflow-hidden"><div className="h-full bg-sky-500 animate-pulse w-1/2" /></div>}
            </button>
          ))}
        </div>
      </section>

      {/* ── Interest tags ────────────────────────────── */}
      <section className="glass-card space-y-3">
        <h3 className="font-mono text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center gap-2">
          <Tag size={13} className="text-amber-400" /> 興味タグ
          <span className="text-slate-700 font-normal">— マッチした記事を優先表示</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {interestTags.map(tag => (
            <span key={tag} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono text-xs">
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:text-red-400 transition-colors leading-none">×</button>
            </span>
          ))}
          <form onSubmit={addTag} className="flex gap-1">
            <input value={newTag} onChange={e => setNewTag(e.target.value)}
              placeholder="+ タグ追加" maxLength={30}
              className="bg-white/5 border border-white/10 rounded-md font-mono text-xs text-slate-300 px-2.5 py-1 focus:outline-none focus:border-amber-500/40 w-28 transition-colors" />
          </form>
        </div>
        {interestTags.length === 0 && (
          <p className="font-mono text-[11px] text-slate-700">タグを追加すると、データタブで関連記事が優先表示されます</p>
        )}
      </section>

      {/* ── Sources ─────────────────────────────────── */}
      <section className="glass-card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center gap-2">
            <Cpu size={13} className="text-indigo-400" /> 情報ソース
          </h3>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-emerald-500 border border-emerald-500/20 bg-emerald-500/10 px-2 py-px rounded">{activeCount} ACTIVE</span>
            <span className="font-mono text-[10px] text-sky-400 border border-sky-500/20 bg-sky-500/10 px-2 py-px rounded">{candidateCount} CANDIDATE</span>
          </div>
        </div>

        <form onSubmit={handleAddKeyword} className="flex gap-2">
          <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
            placeholder="新規キーワードを追加..." maxLength={100}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg py-2 px-3 font-mono text-xs text-slate-300 focus:outline-none focus:border-sky-500/40 transition-colors" />
          <button type="submit" disabled={isAdding || !newKeyword.trim()}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-40">
            <Plus size={12} /> ADD
          </button>
        </form>

        <div className="overflow-x-auto rounded-lg border border-white/5">
          <table className="w-full text-left">
            <thead className="font-mono text-[10px] text-slate-600 uppercase tracking-widest border-b border-white/5">
              <tr>
                <th className="px-4 py-2.5">TYPE</th>
                <th className="px-4 py-2.5">VALUE</th>
                <th className="px-4 py-2.5">STATUS</th>
                <th className="px-4 py-2.5">SCORE</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {isLoadingData
                ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
                : sourcesList.map(src => (
                  <tr key={src.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
                        {src.type === 'keyword'
                          ? <Hash size={11} className="text-sky-500" />
                          : <Globe size={11} className="text-emerald-500" />}
                        {src.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300 max-w-[200px] truncate">{src.value}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-[10px] px-2 py-px rounded border uppercase font-bold ${STATUS_STYLE[src.status ?? ''] ?? STATUS_STYLE.stopped}`}>
                        {src.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-sky-500 to-indigo-500"
                            style={{ width: `${Math.min(100, Math.max(0, ((src.score ?? 0) + 20) * 2.5))}%` }} />
                        </div>
                        <span className="font-mono text-[10px] text-slate-600">{(src.score ?? 0).toFixed(0)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => onDeleteSource(src.id)}
                        className="text-slate-700 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-500/10">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
