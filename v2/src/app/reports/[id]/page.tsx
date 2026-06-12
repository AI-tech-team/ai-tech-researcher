import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrainCircuit, ArrowLeft, ArrowRight } from 'lucide-react';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { getReportById, getAdjacentReports } from '@/app/actions';
import { ReportView } from '@/components/ReportView';
import { JsonLd } from '@/components/JsonLd';

const TYPE_LABEL: Record<string, string> = { daily: 'デイリーレポート', weekly: '週次レポート', monthly: '月次レポート' };

// レポートごとの全画面ページ。直リンク/リロード/共有/検索インデックス向けにSSRする。
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const report = await getReportById(Number(id));
  if (!report) return { title: 'レポートが見つかりません' };
  const label = TYPE_LABEL[report.type] ?? 'レポート';
  const title = `${label} ${report.reportDate}`;
  const description = `${SITE_NAME} の${label}（${report.reportDate}）。`;
  return {
    title, description,
    openGraph: { title, description, type: 'article', url: `/reports/${id}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReportById(Number(id));
  if (!report) notFound();

  // レポートは自前生成のIP → Article として構造化（記事ページは第三者著作なので付けない）。
  const label = TYPE_LABEL[report.type] ?? 'レポート';
  const adj = await getAdjacentReports(report.type, report.reportDate);
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${label} ${report.reportDate ?? ''}`.trim(),
    ...(report.reportDate ? { datePublished: report.reportDate, dateModified: report.reportDate } : {}),
    inLanguage: 'ja',
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png` } },
    image: `${SITE_URL}/icon-512.png`,
    description: `${SITE_NAME} の${label}（${report.reportDate ?? ''}）。`,
    mainEntityOfPage: `${SITE_URL}/reports/${id}`,
  };

  return (
    <div className="min-h-screen">
      <JsonLd data={articleJsonLd} />
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

        {/* 前後の同種レポートへのナビ */}
        {(adj.prev || adj.next) && (
          <nav className="mt-5 flex items-stretch justify-between gap-3">
            {adj.prev ? (
              <Link href={`/reports/${adj.prev.id}`} scroll={false}
                className="flex-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] px-3.5 py-2.5 transition-colors group">
                <ArrowLeft size={15} className="text-slate-500 group-hover:text-sky-400 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[10px] text-slate-600">前の{label}</span>
                  <span className="block text-xs font-bold text-slate-300 truncate">{adj.prev.reportDate}</span>
                </span>
              </Link>
            ) : <span className="flex-1" />}
            {adj.next ? (
              <Link href={`/reports/${adj.next.id}`} scroll={false}
                className="flex-1 flex items-center justify-end gap-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] px-3.5 py-2.5 transition-colors group text-right">
                <span className="min-w-0">
                  <span className="block text-[10px] text-slate-600">次の{label}</span>
                  <span className="block text-xs font-bold text-slate-300 truncate">{adj.next.reportDate}</span>
                </span>
                <ArrowRight size={15} className="text-slate-500 group-hover:text-sky-400 shrink-0" />
              </Link>
            ) : <span className="flex-1" />}
          </nav>
        )}

        <div className="mt-6">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> 一覧に戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
