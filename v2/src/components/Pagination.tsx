import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';

// 一覧の前後ページ送り（/category・/tag 共用）。
export function Pagination({ prevHref, nextHref, page }: { prevHref: string | null; nextHref: string | null; page: number }) {
  if (!prevHref && !nextHref) return null;
  const cls = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 text-xs font-bold transition-colors';
  return (
    <div className="mt-6 flex items-center justify-between">
      {prevHref ? <Link href={prevHref} scroll={false} className={cls}><ArrowLeft size={13} /> 前のページ</Link> : <span />}
      <span className="font-mono text-[11px] text-slate-600">{page}</span>
      {nextHref ? <Link href={nextHref} scroll={false} className={cls}>次のページ <ArrowRight size={13} /></Link> : <span />}
    </div>
  );
}
