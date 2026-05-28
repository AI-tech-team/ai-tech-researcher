"use client";

import { useEffect } from 'react';
import { X, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { renderMarkdown } from '@/components/Markdown';
import type { Report } from '@/types';

const TYPE_LABEL: Record<string, string> = {
  daily: 'デイリーレポート', weekly: '週次レポート', monthly: '月次レポート',
};

interface Props {
  report: Report | null;
  onClose: () => void;
  onArticleRef?: (id: number) => void;
}

// 公開UI向け: レポート全文をモーダルで読む
export function ReportModal({ report, onClose, onArticleRef }: Props) {
  useEffect(() => {
    if (!report) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [report, onClose]);

  return (
    <AnimatePresence>
      {report && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-6"
        >
          <motion.div
            initial={{ y: 30, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full sm:max-w-2xl max-h-[90vh] sm:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#070b16] shadow-2xl"
          >
            <button onClick={onClose}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/40 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <X size={18} />
            </button>
            <div className="p-5 sm:p-7 space-y-4">
              <div className="flex items-center gap-2 flex-wrap pr-8 border-b border-white/5 pb-4">
                <FileText size={16} className="text-emerald-400" />
                <h2 className="text-base font-bold text-white">{TYPE_LABEL[report.type] ?? 'レポート'}</h2>
                <span className="ml-auto text-xs text-slate-400 bg-white/5 px-3 py-1 rounded-full">{report.reportDate}</span>
              </div>
              <div>{renderMarkdown(report.content ?? '', onArticleRef)}</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
