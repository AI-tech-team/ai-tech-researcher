import type { Metadata } from 'next';
import Link from 'next/link';
import { BrainCircuit, ArrowLeft } from 'lucide-react';
import { SITE_NAME } from '@/lib/site';
import { CHANGELOG, LAUNCH_DATE, RELEASE_STAGE, type ChangeCategory } from '@/lib/changelog';

export const metadata: Metadata = {
  title: '更新履歴',
  description: `${SITE_NAME} のこれまでの歩みと、主なアップデートの記録。`,
};

// カテゴリごとのバッジ配色（落ち着いた配色で本文を邪魔しない）
const CATEGORY_STYLE: Record<ChangeCategory, string> = {
  '新機能': 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  '改善': 'text-sky-300 bg-sky-500/10 border-sky-500/20',
  '修正': 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  'プライバシー・規約': 'text-slate-300 bg-white/5 border-white/10',
};

export default function ChangelogPage() {
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

      <main className="max-w-2xl mx-auto px-5 py-8 sm:py-10">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl font-bold text-white font-outfit">更新履歴</h1>
          <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border border-amber-500/30 text-amber-300 bg-amber-500/10">
            {RELEASE_STAGE}
          </span>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed mt-3">
          {SITE_NAME} は現在{RELEASE_STAGE}として公開中です。機能は日々改善しており、表示や仕様が変わることがあります。
          始動（{LAUNCH_DATE}）からの歩みと、主なアップデートをお知らせします。
        </p>

        {/* タイムライン（左に縦線、各更新にバージョン番号付き） */}
        <ol className="mt-10 border-l border-white/10 pl-6 space-y-7">
          {CHANGELOG.map((e) => (
            <li key={e.version} className="relative">
              {/* ドット（節目は大きく光らせる） */}
              <span
                className={
                  e.milestone
                    ? 'absolute -left-[30px] top-1 w-3 h-3 rounded-full bg-sky-400 ring-4 ring-[#03060f] shadow-[0_0_10px_2px_rgba(56,189,248,0.5)]'
                    : 'absolute -left-[27px] top-1.5 w-2 h-2 rounded-full bg-slate-600 ring-4 ring-[#03060f]'
                }
              />
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={
                    e.milestone
                      ? 'text-xs font-bold font-mono px-2 py-0.5 rounded-md border border-sky-500/40 text-sky-200 bg-sky-500/15'
                      : 'text-xs font-bold font-mono px-2 py-0.5 rounded-md border border-white/10 text-slate-300 bg-white/[0.04]'
                  }
                >
                  {e.version}
                </span>
                {e.stage && (
                  <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-full border border-amber-500/30 text-amber-300 bg-amber-500/10">
                    {e.stage}
                  </span>
                )}
                <time className="text-[11px] font-mono text-slate-500">{e.date}</time>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${CATEGORY_STYLE[e.category]}`}>
                  {e.category}
                </span>
              </div>
              <p className={`leading-relaxed mt-1.5 ${e.milestone ? 'text-[15px] font-semibold text-white' : 'text-sm text-slate-300'}`}>
                {e.title}
              </p>
              {e.detail && (
                <p className="text-[13px] text-slate-500 leading-relaxed mt-1">{e.detail}</p>
              )}
            </li>
          ))}
        </ol>

        <footer className="mt-14 pt-6 border-t border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <Link href="/privacy" className="hover:text-white transition-colors">プライバシー</Link>
            <span className="text-slate-700">·</span>
            <Link href="/terms" className="hover:text-white transition-colors">利用規約</Link>
          </div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> トップに戻る
          </Link>
        </footer>
      </main>
    </div>
  );
}
