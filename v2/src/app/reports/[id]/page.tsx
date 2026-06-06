import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrainCircuit, ArrowLeft } from 'lucide-react';
import { SITE_NAME } from '@/lib/site';
import { getReportById } from '@/app/actions';
import { ReportView } from '@/components/ReportView';

const TYPE_LABEL: Record<string, string> = { daily: 'デイリーレポート', weekly: '週次レポート', monthly: '月次レポート' };

// レポートごとの全画面ページ。直リンク/リロード/共有/検索インデックス向けにSSRする。
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const report = await getReportById(Number(id));
  if (!report) return { title: 'レポートが見つかりません' };
  const label = TYPE_LABEL[report.type] ?? 'レポート';
  const title = `${label} ${report.reportDate}`;
  const description = `${SITE_NAME} の${label}（${report.reportDate}）。`;
  return { title, description, openGraph: { title, description, type: 'article', url: `/reports/${id}` } };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReportById(Number(id));
  if (!report) notFound();

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

      <main className="max-w-2xl mx-auto px-3 sm:px-5 py-6 sm:py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <article className="rounded-2xl border border-white/10 bg-[#070b16]">
          <ReportView report={report} />
        </article>
        <div className="mt-6">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> 一覧に戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
