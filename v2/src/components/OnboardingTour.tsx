"use client";

import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight, ArrowLeft, X, LogIn } from 'lucide-react';

interface OnboardingTourProps {
  step: number;
  total: number;
  title: string;
  body: string;
  isLast: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onLogin: () => void;
}

// 初見ユーザー向けの一般的なステップ式ツアー。
// 画面は暗転させず、カードをコーナー（PC=右下 / モバイル=下部中央）にフロートさせる。
// これにより「対象タブの中身」と「左ナビのアクティブ表示」の両方が見えたまま説明できる。
// 要素の位置計算（スポットライト）は使わずレイアウト依存のバグを避ける。
export function OnboardingTour({ step, total, title, body, isLast, onNext, onBack, onSkip, onLogin }: OnboardingTourProps) {
  return (
    <AnimatePresence>
      <motion.div
        key="onboarding-wrap"
        className="fixed inset-x-0 bottom-0 z-[100] flex justify-center md:justify-end px-4 pb-20 md:pb-6 md:pr-6 pointer-events-none"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        <motion.div
          className="pointer-events-auto relative w-full max-w-md md:max-w-sm rounded-2xl border border-sky-500/25 bg-[#0a0f1c]/95 backdrop-blur-md p-5 shadow-2xl shadow-black/60"
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.2 }}
        >
          <button onClick={onSkip} aria-label="スキップ"
            className="absolute right-3 top-3 p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
            <X size={16} />
          </button>

          <div className="flex items-center gap-2 text-sky-400 mb-2.5">
            <Sparkles size={16} />
            <span className="text-[11px] font-mono tracking-widest">使い方 {step + 1}/{total}</span>
          </div>

          <h2 className="text-lg font-bold text-slate-100 mb-2 font-outfit">{title}</h2>
          <p className="text-sm leading-relaxed text-slate-300 whitespace-pre-line">{body}</p>

          <div className="mt-4 flex items-center justify-center gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-sky-400' : 'w-1.5 bg-white/15'}`} />
            ))}
          </div>

          {isLast ? (
            <div className="mt-4 flex flex-col gap-2">
              <button onClick={onLogin}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-bold transition-colors">
                <LogIn size={14} /> ログインして始める
              </button>
              <div className="flex items-center justify-between">
                {step > 0 ? (
                  <button onClick={onBack} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                    <ArrowLeft size={13} /> 戻る
                  </button>
                ) : <span />}
                <button onClick={onNext} className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
                  ログインせずに始める
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex items-center justify-between">
              <button onClick={onSkip} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">スキップ</button>
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <button onClick={onBack}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 text-xs hover:bg-white/5 transition-colors">
                    <ArrowLeft size={13} /> 戻る
                  </button>
                )}
                <button onClick={onNext}
                  className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold transition-colors">
                  次へ <ArrowRight size={13} />
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
