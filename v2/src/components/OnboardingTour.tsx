"use client";

import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight, ArrowLeft, X } from 'lucide-react';

interface OnboardingTourProps {
  step: number;
  total: number;
  title: string;
  body: string;
  isLast: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

// 初見ユーザー向けの一般的なステップ式ツアー（中央カード）。
// 要素の位置計算（スポットライト）は使わず、レイアウト依存のバグを避ける。
export function OnboardingTour({ step, total, title, body, isLast, onNext, onBack, onSkip }: OnboardingTourProps) {
  return (
    <AnimatePresence>
      <motion.div
        key="onboarding-overlay"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        <motion.div
          className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0f1c] p-6 shadow-2xl"
          initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18 }}
        >
          <button onClick={onSkip} aria-label="スキップ"
            className="absolute right-3 top-3 p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
            <X size={16} />
          </button>

          <div className="flex items-center gap-2 text-sky-400 mb-3">
            <Sparkles size={16} />
            <span className="text-[11px] font-mono tracking-widest">使い方 {step + 1}/{total}</span>
          </div>

          <h2 className="text-lg font-bold text-slate-100 mb-2 font-outfit">{title}</h2>
          <p className="text-sm leading-relaxed text-slate-300 whitespace-pre-line">{body}</p>

          <div className="mt-5 flex items-center justify-center gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-sky-400' : 'w-1.5 bg-white/15'}`} />
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between">
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
                {isLast ? '始める' : '次へ'} {!isLast && <ArrowRight size={13} />}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
