"use client";

import { useState, useEffect, useCallback } from 'react';
import {
  Mail, Calendar, ShieldCheck, Tag, Target, Fingerprint, Star, Bookmark,
  CheckCircle2, LogOut, LogIn, KeyRound, ArrowRight, Activity,
} from 'lucide-react';
import { signIn, signOut } from 'next-auth/react';
import { useToast } from '@/components/Toast';
import { SkeletonStat } from '@/components/Skeleton';
import {
  getMyProfile, updateMyProfile, getProfileStats, getReadingProfile,
  getOwnerStatus,
  type MyProfile, type ProfileStats,
} from '@/app/actions';
import type { ReadingProfile } from '@/types';

interface ProfileTabProps {
  onInterestsChange?: (tags: string[]) => void;  // 興味の変更を親へ通知（記事の並びに反映）
  onOwnerChange?: () => void;                     // オーナー解錠/施錠を親へ通知（UI出し分け更新）
  onNavigateToDna?: () => void;                   // 分析>読書DNA へ移動
}

// 興味文字列 ⇔ 配列
const parseInterests = (s: string): string[] =>
  [...new Set((s ?? '').split(/[,、\s]+/).map(t => t.trim()).filter(Boolean))];

export function ProfileTab({ onInterestsChange, onNavigateToDna }: ProfileTabProps) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<MyProfile | null | undefined>(undefined);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [dna, setDna] = useState<ReadingProfile | null>(null);
  const [owner, setOwner] = useState<{ isOwner: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [newInterest, setNewInterest] = useState('');

  const loadOwner = useCallback(() => { getOwnerStatus().then(setOwner).catch(() => setOwner(null)); }, []);

  useEffect(() => {
    getMyProfile().then(p => setProfile(p)).catch(() => setProfile(null));
    getProfileStats().then(setStats).catch(() => setStats(null));
    getReadingProfile().then(setDna).catch(() => setDna(null));
    loadOwner();
  }, [loadOwner]);

  const interests = profile ? parseInterests(profile.interests) : [];

  // 全フィールド永続化（patchで一部上書き）
  const persist = async (patch: Partial<Pick<MyProfile, 'displayName' | 'interests' | 'goals' | 'emailOptIn'>>) => {
    if (!profile) return false;
    const merged = { ...profile, ...patch };
    const r = await updateMyProfile({
      displayName: merged.displayName, interests: merged.interests,
      goals: merged.goals, emailOptIn: merged.emailOptIn,
    });
    return r.success;
  };

  const saveAll = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const ok = await persist({});
      toast(ok ? 'プロフィールを保存しました' : '保存に失敗しました', ok ? 'success' : 'error');
    } catch {
      toast('保存に失敗しました', 'error');
    } finally { setSaving(false); }
  };

  // 興味チップ: 追加/削除で即保存＋親へ通知
  const commitInterests = async (next: string[]) => {
    const str = next.join(', ');
    setProfile(p => p && { ...p, interests: str });
    onInterestsChange?.(next);
    await persist({ interests: str });
  };
  const addInterest = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = newInterest.trim();
    if (!t || interests.some(i => i.toLowerCase() === t.toLowerCase())) { setNewInterest(''); return; }
    setNewInterest('');
    await commitInterests([...interests, t]);
  };
  const removeInterest = (tag: string) => commitInterests(interests.filter(t => t !== tag));


  /* ── 未ログイン ── */
  if (profile === null) {
    return (
      <div className="glass-card flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center">
          <LogIn className="text-white" size={26} />
        </div>
        <p className="text-sm">ログインするとプロフィールを設定できます</p>
        <button onClick={() => signIn('google')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 text-sm font-bold transition-colors">
          <LogIn size={15} /> Googleでログイン
        </button>
      </div>
    );
  }

  /* ── 読み込み中 ── */
  if (profile === undefined) {
    return <div className="space-y-4"><SkeletonStat /><SkeletonStat /></div>;
  }

  const memberSince = profile.memberSince
    ? new Date(profile.memberSince.replace(' ', 'T') + 'Z').toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', timeZone: 'Asia/Tokyo' })
    : null;
  const initial = (profile.displayName || profile.name || profile.email || '?').slice(0, 1).toUpperCase();

  return (
    <div className="space-y-6 max-w-3xl">

      {/* ── ヘッダー ── */}
      <section className="glass-card flex items-center gap-4">
        {profile.image
          ? <img src={profile.image} alt="" className="w-16 h-16 rounded-2xl flex-shrink-0" />
          : <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">{initial}</div>}
        <div className="min-w-0 flex-1">
          <input
            value={profile.displayName}
            maxLength={80}
            placeholder={profile.name || '表示名を設定'}
            onChange={e => setProfile(p => p && { ...p, displayName: e.target.value })}
            className="w-full bg-transparent text-xl font-bold text-white font-outfit focus:outline-none focus:bg-white/5 rounded px-1 -ml-1 transition-colors" />
          <div className="flex items-center gap-3 mt-1 flex-wrap text-[11px] text-slate-500 font-mono">
            {profile.email && <span className="flex items-center gap-1"><Mail size={11} />{profile.email}</span>}
            {memberSince && <span className="flex items-center gap-1"><Calendar size={11} />{memberSince}から</span>}
            {owner?.isOwner && (
              <span className="flex items-center gap-1 text-amber-400 border border-amber-500/30 bg-amber-500/10 px-1.5 py-px rounded">
                <ShieldCheck size={11} /> オーナー
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ── 統計 ── */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'お気に入り', value: stats.favorited, icon: <Star size={14} className="text-amber-400" /> },
            { label: '後で読む',   value: stats.readLater, icon: <Bookmark size={14} className="text-sky-400" /> },
            { label: '既読',       value: stats.read,      icon: <CheckCircle2 size={14} className="text-emerald-400" /> },
            { label: '行動ログ',   value: stats.events,    icon: <Activity size={14} className="text-purple-400" /> },
          ].map(s => (
            <div key={s.label} className="glass-card flex flex-col items-center gap-1 py-3">
              {s.icon}
              <span className="text-xl font-bold text-white font-outfit">{s.value}</span>
              <span className="text-[10px] text-slate-500">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── 興味（チップ）── */}
      <section className="glass-card space-y-3">
        <h3 className="font-mono text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center gap-2">
          <Tag size={13} className="text-amber-400" /> 興味
          <span className="text-slate-700 font-normal normal-case tracking-normal">— マッチした記事を優先表示・推薦・チャットに反映</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {interests.map(tag => (
            <span key={tag} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono text-xs">
              {tag}
              <button onClick={() => removeInterest(tag)} className="hover:text-red-400 transition-colors leading-none">×</button>
            </span>
          ))}
          <form onSubmit={addInterest} className="flex gap-1">
            <input value={newInterest} onChange={e => setNewInterest(e.target.value)}
              placeholder="+ 興味を追加" maxLength={40}
              className="bg-white/5 border border-white/10 rounded-md font-mono text-xs text-slate-300 px-2.5 py-1 focus:outline-none focus:border-amber-500/40 w-32 transition-colors" />
          </form>
        </div>
        {interests.length === 0 && (
          <p className="font-mono text-[11px] text-slate-700">興味を追加すると、記事タブで関連記事が優先表示されます</p>
        )}
      </section>

      {/* ── いま調べていること・目標 ── */}
      <section className="glass-card space-y-2">
        <h3 className="font-mono text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center gap-2">
          <Target size={13} className="text-sky-400" /> いま調べていること・目標
        </h3>
        <p className="text-[11px] text-slate-600">チャットの回答と「あなたへのおすすめ」に反映されます</p>
        <textarea value={profile.goals} maxLength={500} rows={3}
          placeholder="例: 業務でエージェント型RAGの導入を検討中。評価手法とコスト最適化を調べている。"
          onChange={e => setProfile(p => p && { ...p, goals: e.target.value })}
          className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-sky-500/40 transition-colors resize-none" />
      </section>

      {/* ── 読書DNA要約 ── */}
      {dna && (
        <section className="glass-card space-y-4 border-indigo-500/15">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center gap-2">
              <Fingerprint size={13} className="text-indigo-400" /> 読書DNA
            </h3>
            {onNavigateToDna && (
              <button onClick={onNavigateToDna} className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors">
                詳しく見る <ArrowRight size={12} />
              </button>
            )}
          </div>
          <div>
            <p className="text-base font-bold text-white font-outfit">{dna.persona || '分析中'}</p>
            <p className="text-[11px] text-slate-500">{dna.totalEvents}件の行動から分析</p>
          </div>
          <div className="flex flex-col gap-3">
            {dna.radar.map(ax => (
              <div key={ax.axis}>
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className={ax.value <= 45 ? 'text-white font-semibold' : 'text-slate-500'}>{ax.leftLabel}</span>
                  <span className={ax.value >= 55 ? 'text-white font-semibold' : 'text-slate-500'}>{ax.rightLabel}</span>
                </div>
                <div className="relative h-1.5 rounded-full bg-white/10">
                  <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 shadow -ml-1.5"
                    style={{ left: `${ax.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── メール配信 ── */}
      <section className="glass-card space-y-2">
        <h3 className="font-mono text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center gap-2">
          <Mail size={13} className="text-emerald-400" /> メール配信
        </h3>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={profile.emailOptIn}
            onChange={e => setProfile(p => p && { ...p, emailOptIn: e.target.checked })}
            className="accent-sky-500" />
          <span className="text-xs text-slate-300">朝のパーソナライズbrief（今日読むべき記事）を受け取る</span>
        </label>
      </section>

      {/* ── 保存 ── */}
      <button onClick={saveAll} disabled={saving} className="btn-primary disabled:opacity-40">
        {saving ? '保存中...' : 'プロフィールを保存'}
      </button>

      {/* ── オーナー権限 ── */}
      <section className="glass-card space-y-3">
        <h3 className="font-mono text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center gap-2">
          <KeyRound size={13} className="text-amber-400" /> オーナー権限
        </h3>
        {owner == null ? (
          <p className="font-mono text-[11px] text-slate-600">確認中...</p>
        ) : owner.isOwner ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <ShieldCheck size={14} /> オーナーとしてログイン中 — パイプライン実行・ソース管理・チャットが利用できます
          </span>
        ) : (
          <p className="text-[12px] text-slate-500 leading-relaxed">
            このアカウントはオーナーではありません。オーナーのGoogleアカウントでログインすると、同期・設定・チャットなどの管理機能が使えます。
          </p>
        )}
      </section>

      {/* ── ログアウト ── */}
      <button onClick={() => signOut()}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-red-500/10 hover:border-red-500/20 text-slate-400 hover:text-red-400 text-sm transition-colors">
        <LogOut size={15} /> ログアウト
      </button>
    </div>
  );
}
