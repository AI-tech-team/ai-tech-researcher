"use client";

import { useRouter } from 'next/navigation';
import { FileText, List, ChevronDown } from 'lucide-react';
import { renderMarkdown, extractHeadings } from '@/components/Markdown';
import { ShareButtons } from '@/components/ShareButtons';
import { AiBadge } from '@/components/AiBadge';
import { SITE_URL } from '@/lib/site';
import type { Report } from '@/types';

const TYPE_LABEL: Record<string, string> = {
  daily: 'デイリーレポート', weekly: '週次レポート', monthly: '月次レポート',
};

// レポート本文の表示部。モーダル(intercept)と全画面ページ(/reports/[id])で共用。
// 本文中の [ID:N] 出典は記事ページ(/articles/[id])へ遷移させる。
export function ReportView({ report }: { report: Report }) {
  const router = useRouter();
  const label = TYPE_LABEL[report.type] ?? 'レポート';
  const content = report.content ?? '';
  const headings = extractHeadings(content);
  return (
    <div className="p-5 sm:p-7 space-y-4">
      <div className="flex items-center gap-2 flex-wrap pr-8 border-b border-white/5 pb-4">
        <FileText size={16} className="text-emerald-400" />
        <h1 className="text-base font-bold text-white">{label}</h1>
        <AiBadge />
        <span className="ml-auto text-xs text-slate-400 bg-white/5 px-3 py-1 rounded-full">{report.reportDate}</span>
      </div>

      {/* 目次（見出し3つ以上のとき・JS不要の折りたたみ） */}
      {headings.length >= 3 && (
        <details className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5 group">
          <summary className="flex items-center gap-1.5 cursor-pointer list-none text-xs font-bold text-slate-300 [&::-webkit-details-marker]:hidden">
            <List size={13} className="text-sky-400" /> 目次
            <span className="text-slate-600 font-normal">（{headings.length}）</span>
            <ChevronDown size={14} className="ml-auto text-slate-500 group-open:rotate-180 transition-transform" />
          </summary>
          <nav className="mt-2.5 flex flex-col gap-1">
            {headings.map((h) => (
              <a key={h.id} href={`#${h.id}`}
                className={`text-slate-400 hover:text-sky-300 transition-colors ${h.level === 2 ? 'pl-4 text-[12px]' : 'text-[13px]'}`}>
                {h.text}
              </a>
            ))}
          </nav>
        </details>
      )}

      <div>{renderMarkdown(content, (id) => router.push(`/articles/${id}`))}</div>
      <ShareButtons url={`${SITE_URL}/reports/${report.id}`} title={`${label} ${report.reportDate}`} />
    </div>
  );
}
