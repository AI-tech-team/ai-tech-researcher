"use client";

import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { renderMarkdown } from '@/components/Markdown';
import { ShareButtons } from '@/components/ShareButtons';
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
  return (
    <div className="p-5 sm:p-7 space-y-4">
      <div className="flex items-center gap-2 flex-wrap pr-8 border-b border-white/5 pb-4">
        <FileText size={16} className="text-emerald-400" />
        <h1 className="text-base font-bold text-white">{label}</h1>
        <span className="ml-auto text-xs text-slate-400 bg-white/5 px-3 py-1 rounded-full">{report.reportDate}</span>
      </div>
      <div>{renderMarkdown(report.content ?? '', (id) => router.push(`/articles/${id}`))}</div>
      <ShareButtons url={`${SITE_URL}/reports/${report.id}`} title={`${label} ${report.reportDate}`} />
    </div>
  );
}
