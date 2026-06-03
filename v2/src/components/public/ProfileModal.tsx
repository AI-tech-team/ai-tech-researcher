"use client";

import { useEffect, useState } from 'react';
import { X, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getMyProfile, updateMyProfile } from '@/app/actions';
import { useToast } from '@/components/Toast';

type ProfileData = {
  email: string | null;
  name: string | null;
  image: string | null;
  memberSince: string | null;
  displayName: string;
  interests: string;
  goals: string;
  emailOptIn: boolean;
};

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

// 公開UIのログインユーザー向けプロフィール編集モーダル。
// 興味/目標を保存することで「あなた向け」推薦の精度が上がる。
export function ProfileModal({ open, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [data, setData] = useState<ProfileData | null>(null);
  const [interests, setInterests] = useState('');
  const [goals, setGoals] = useState('');
  const [saving, setSaving] = useState(false);

  // 開いたら最新のプロフィールを取得（setStateは全て.then内＝非同期、lintクリーン）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getMyProfile().then(p => {
      if (cancelled || !p) return;
      setData(p);
      setInterests(p.interests ?? '');
      setGoals(p.goals ?? '');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const handleSave = async () => {
    if (!data || saving) return;
    setSaving(true);
    try {
      const r = await updateMyProfile({
        // displayNameは公開UIで非表示なので既存値をそのまま保持（消さない）
        displayName: data.displayName ?? '',
        interests: interests.trim().slice(0, 400),
        goals: goals.trim().slice(0, 400),
        emailOptIn: data.emailOptIn,
      });
      if (r.success) {
        toast('プロフィールを保存しました', 'success');
        onSaved?.();
        onClose();
      } else {
        toast('保存に失敗しました', 'error');
      }
    } catch {
      toast('保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-[65] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-6"
        >
          <motion.div
            initial={{ y: 30, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full sm:max-w-md max-h-[90vh] sm:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#070b16] shadow-2xl"
          >
            <button onClick={onClose}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/40 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <X size={18} />
            </button>

            <div className="p-5 sm:p-6 space-y-5">
              {/* ユーザー情報 */}
              <div className="flex items-center gap-3 pb-4 border-b border-white/5 pr-8">
                {data?.image
                  ? <img src={data.image} alt="" className="w-12 h-12 rounded-full" />
                  : <div className="w-12 h-12 rounded-full bg-sky-500/20 flex items-center justify-center text-sky-400 text-base font-bold">
                      {(data?.name ?? '?').slice(0, 1)}
                    </div>}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{data?.name ?? '読み込み中…'}</p>
                  {data?.email && <p className="text-[11px] text-slate-500 truncate">{data.email}</p>}
                </div>
              </div>

              {/* 興味 */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">興味のあるテーマ</label>
                <textarea value={interests} onChange={e => setInterests(e.target.value)} maxLength={400} rows={2}
                  placeholder="LLM推論, エージェント, RAG, etc."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500/50 transition-colors resize-none" />
                <p className="text-[10px] text-slate-600 mt-1">カンマ区切りでいくつでも。「あなた向け」のおすすめ精度が上がります。</p>
              </div>

              {/* 目標 */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">目標・関心（任意）</label>
                <textarea value={goals} onChange={e => setGoals(e.target.value)} maxLength={400} rows={3}
                  placeholder="自分のRAGアプリを改善したい / 業界トレンドを追いたい …"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500/50 transition-colors resize-none" />
              </div>

              {/* メール配信設定（毎朝のあなた向けダイジェスト） */}
              <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-slate-200">毎朝のメールダイジェスト</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    あなたの興味に近い新着を毎朝メールでお届けします。いつでも停止できます。
                  </p>
                </div>
                <button type="button" role="switch" aria-checked={data?.emailOptIn ?? false}
                  aria-label="毎朝のメールダイジェストを受け取る"
                  onClick={() => setData(d => d ? { ...d, emailOptIn: !d.emailOptIn } : d)}
                  className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${data?.emailOptIn ? 'bg-sky-500' : 'bg-white/15'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${data?.emailOptIn ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              <div className="flex items-center justify-end pt-2">
                <button onClick={handleSave} disabled={saving || !data}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-sm font-bold shadow-lg shadow-sky-500/20 hover:opacity-90 transition-opacity disabled:opacity-50">
                  <Save size={14} className={saving ? 'animate-spin' : ''} />
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
