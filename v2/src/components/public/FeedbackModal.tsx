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
        // 全画面表示（1画面）：背面を覆う不透明レイヤー
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[70] bg-[#03060f] overflow-y-auto"
        >
          {/* トップバー（タイトル＋閉じる） */}
          <header className="sticky top-0 z-10 backdrop-blur-md bg-[#03060f]/85 border-b border-white/5">
            <div className="max-w-2xl mx-auto flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-sky-400" />
                <span className="font-bold text-sm font-outfit text-white">フィードバック</span>
              </div>
              <button onClick={onClose} aria-label="閉じる"
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
                <X size={16} /> 閉じる
              </button>
            </div>
          </header>

          {/* 本文：中央寄せの1画面 */}
          <main className="max-w-2xl mx-auto px-5 py-10 sm:py-14">
            <h1 className="text-2xl font-bold text-white font-outfit">フィードバック</h1>

            {formMode ? (
              <>
                <p className="text-sm text-slate-400 leading-relaxed mt-3">
                  不具合・ご要望・気づいた点など、何でもどうぞ。匿名で送信されます。
                </p>
                <textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} rows={10}
                  autoFocus
                  placeholder="例：保存ボタンがたまに反応しない / こんな機能がほしい …"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-base text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500/50 transition-colors resize-none mt-6" />
                <div className="flex items-center justify-between mt-1.5">
                  {FEEDBACK_ENTRY_EMAIL ? (
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={200}
                      placeholder="返信先メール（任意）"
                      className="flex-1 mr-3 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500/50 transition-colors" />
                  ) : <span />}
                  <span className="text-[11px] font-mono text-slate-600 shrink-0">{message.length}/2000</span>
                </div>
                <div className="flex items-center justify-end mt-5">
                  <button onClick={submit} disabled={sending || !message.trim()}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-sm font-bold shadow-lg shadow-sky-500/20 hover:opacity-90 transition-opacity disabled:opacity-50">
                    <Send size={15} className={sending ? 'animate-pulse' : ''} />
                    {sending ? '送信中…' : '送信する'}
                  </button>
                </div>
              </>
            ) : (
              // フォーム未設定時のフォールバック（メール）
              <div className="space-y-3 mt-4">
                <p className="text-sm text-slate-300 leading-relaxed">
                  ご意見・ご要望をお寄せください。
                </p>
                {CONTACT_EMAIL ? (
                  <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Knowledge Tree フィードバック')}`}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-sm font-bold shadow-lg shadow-sky-500/20 hover:opacity-90 transition-opacity">
                    <Send size={14} /> メールで送る
                  </a>
                ) : (
                  <p className="text-[12px] text-slate-500">現在フィードバック窓口を準備中です。</p>
                )}
              </div>
            )}
          </main>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
