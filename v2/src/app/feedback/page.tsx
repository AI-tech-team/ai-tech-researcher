"use client";

import { useState } from 'react';
import Link from 'next/link';
import { BrainCircuit, ArrowLeft, Send } from 'lucide-react';
import { FEEDBACK_FORM_ACTION, FEEDBACK_ENTRY, FEEDBACK_ENTRY_EMAIL, CONTACT_EMAIL, SITE_NAME } from '@/lib/site';

// 公開UIのフィードバック送信ページ（/feedback）。
// 送信欄は独自UIだが、内容はGoogleフォーム(formResponse)へ直接POSTされ、オーナーは回答一覧で確認できる。匿名。
// フォーム未設定時は CONTACT_EMAIL へのメール送信にフォールバックする。
export default function FeedbackPage() {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const formMode = !!FEEDBACK_FORM_ACTION && !!FEEDBACK_ENTRY;

  const submit = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const body = new URLSearchParams();
      body.append(FEEDBACK_ENTRY, text);
      if (FEEDBACK_ENTRY_EMAIL && email.trim()) body.append(FEEDBACK_ENTRY_EMAIL, email.trim());
      await fetch(FEEDBACK_FORM_ACTION, { method: 'POST', mode: 'no-cors', body });
      setSent(true);
    } catch {
      setError('送信に失敗しました。少し時間をおいて再度お試しください。');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#03060f]/85 border-b border-white/5">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-5 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <BrainCircuit className="text-white" size={15} />
            </div>
            <span className="font-bold text-sm font-outfit">{SITE_NAME}</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> トップ
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-10 sm:py-14">
        <h1 className="text-2xl font-bold text-white font-outfit">フィードバック</h1>

        {sent ? (
          // 送信完了（ページ内でお礼表示）
          <div className="mt-8 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-6 space-y-3">
            <p className="text-base font-bold text-emerald-300">送信しました。ありがとうございます！</p>
            <p className="text-sm text-slate-400 leading-relaxed">いただいた内容は今後の改善に役立てます。</p>
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-bold text-sky-300 hover:text-sky-200 transition-colors">
              <ArrowLeft size={14} /> トップに戻る
            </Link>
          </div>
        ) : formMode ? (
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
            {error && <p className="text-[12px] text-red-400 mt-2">{error}</p>}
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
            <p className="text-sm text-slate-300 leading-relaxed">ご意見・ご要望をお寄せください。</p>
            {CONTACT_EMAIL ? (
              <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`${SITE_NAME} フィードバック`)}`}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-sm font-bold shadow-lg shadow-sky-500/20 hover:opacity-90 transition-opacity">
                <Send size={14} /> メールで送る
              </a>
            ) : (
              <p className="text-[12px] text-slate-500">現在フィードバック窓口を準備中です。</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
