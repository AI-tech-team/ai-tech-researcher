"use client";

import { useEffect, useState } from 'react';
import { X, Send, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/Toast';
import { FEEDBACK_FORM_ACTION, FEEDBACK_ENTRY, FEEDBACK_ENTRY_EMAIL, CONTACT_EMAIL } from '@/lib/site';

interface Props {
  open: boolean;
  onClose: () => void;
}

// 公開UIのフィードバック送信モーダル。
// 送信欄はサイト独自UIだが、送信内容はGoogleフォーム(formResponse)へ直接POSTされ、
// オーナーはフォームの回答一覧で確認できる。匿名（個人情報は集めない）。
// フォーム未設定(env未設定)のときは CONTACT_EMAIL へのメール送信にフォールバックする。
export function FeedbackModal({ open, onClose }: Props) {
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  // Googleフォーム送信が使えるか（action と本文entryの両方が要る）
  const formMode = !!FEEDBACK_FORM_ACTION && !!FEEDBACK_ENTRY;

  // Escで閉じる
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  // 閉じたら入力をリセット
  useEffect(() => {
    if (!open) { setMessage(''); setEmail(''); setSending(false); }
  }, [open]);

  const submit = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      // Googleフォームへ no-cors でPOST（レスポンスは不透明だが記録される）
      const body = new URLSearchParams();
      body.append(FEEDBACK_ENTRY, text);
      if (FEEDBACK_ENTRY_EMAIL && email.trim()) body.append(FEEDBACK_ENTRY_EMAIL, email.trim());
      await fetch(FEEDBACK_FORM_ACTION, { method: 'POST', mode: 'no-cors', body });
      toast('フィードバックを送信しました。ありがとうございます！', 'success');
      onClose();
    } catch {
      toast('送信に失敗しました。通信状況を確認してください', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-6"
        >
          <motion.div
            initial={{ y: 30, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#070b16] shadow-2xl"
          >
            <button onClick={onClose}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/40 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <X size={18} />
            </button>

            <div className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2 pr-8">
                <MessageSquare size={18} className="text-sky-400" />
                <h2 className="text-base font-bold text-white font-outfit">フィードバック</h2>
              </div>

              {formMode ? (
                <>
                  <p className="text-[12px] text-slate-400 leading-relaxed">
                    不具合・ご要望・気づいた点など、何でもどうぞ。匿名で送信されます。
                  </p>
                  <textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} rows={5}
                    autoFocus
                    placeholder="例：保存ボタンがたまに反応しない / こんな機能がほしい …"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500/50 transition-colors resize-none" />
                  {FEEDBACK_ENTRY_EMAIL && (
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={200}
                      placeholder="返信先メール（任意）"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500/50 transition-colors" />
                  )}
                  <div className="flex items-center justify-end pt-1">
                    <button onClick={submit} disabled={sending || !message.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-sm font-bold shadow-lg shadow-sky-500/20 hover:opacity-90 transition-opacity disabled:opacity-50">
                      <Send size={14} className={sending ? 'animate-pulse' : ''} />
                      {sending ? '送信中…' : '送信'}
                    </button>
                  </div>
                </>
              ) : (
                // フォーム未設定時のフォールバック（メール）
                <div className="space-y-3">
                  <p className="text-[13px] text-slate-300 leading-relaxed">
                    ご意見・ご要望をお寄せください。
                  </p>
                  {CONTACT_EMAIL ? (
                    <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('AI Tech Researcher フィードバック')}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-sm font-bold shadow-lg shadow-sky-500/20 hover:opacity-90 transition-opacity">
                      <Send size={14} /> メールで送る
                    </a>
                  ) : (
                    <p className="text-[12px] text-slate-500">現在フィードバック窓口を準備中です。</p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
