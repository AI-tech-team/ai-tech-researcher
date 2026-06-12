import Link from 'next/link';
import { BrainCircuit, ArrowLeft } from 'lucide-react';
import { SITE_NAME } from '@/lib/site';
import type { CollectedItem } from '@/types';

// カテゴリ/タグの記事一覧ページ本体（サーバ描画）。/category/[name] と /tag/[name] で共用。
// 各記事は /articles/[id] への本物リンク。公開SEOページなのでユーザー状態は扱わない。
const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': '#38bdf8', 'エージェント': '#818cf8', 'ツール/フレームワーク': '#34d399',
  'ハードウェア': '#fb923c', 'ビジネス応用': '#f472b6', '研究/論文': '#a78bfa', 'その他': '#94a3b8',
};

export function ArticleListView({ kicker, title, articles, topSlot, emptyText }: {
  kicker: string; title: string; articles: CollectedItem[];
  topSlot?: React.ReactNode;   // 見出し下に差し込む要素（検索ボックス等）
  emptyText?: string;
}) {
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
        <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-sky-400/80">{kicker}</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-outfit leading-tight mt-2">
          {title}
          <span className="text-slate-500 text-base font-normal font-sans ml-2">{articles.length}件</span>
        </h1>

        {topSlot && <div className="mt-5">{topSlot}</div>}

        {articles.length === 0 ? (
          <p className="text-sm text-slate-400 leading-relaxed mt-6">{emptyText ?? '該当する記事がまだありません。'}</p>
        ) : (
          <div className="mt-6 flex flex-col gap-2">
            {articles.map((a) => (
              <div key={a.id} className="rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] p-4 transition-colors group relative">
                <div className="flex items-center gap-2 mb-1 font-mono text-[10px]">
                  {a.category && (
                    <Link href={`/category/${encodeURIComponent(a.category)}`} scroll={false} className="relative z-10 hover:underline underline-offset-2" style={{ color: CATEGORY_COLORS[a.category] ?? '#94a3b8' }}>{a.category}</Link>
                  )}
                  <span className="text-amber-400/80">★{a.importanceScore ?? 0}</span>
                  {a.sourceValue && <span className="text-slate-600 truncate">· {a.sourceValue}</span>}
                </div>
                {/* カード全体を記事へのリンクに（カテゴリリンクは上のz-10で優先） */}
                <Link href={`/articles/${a.id}`} scroll={false} className="absolute inset-0" aria-label={a.titleJa || a.title || '記事'} />
                <p className="text-sm font-bold text-slate-100 leading-snug group-hover:text-white transition-colors">{a.titleJa || a.title || '無題'}</p>
                {a.summary && <p className="text-[12px] text-slate-400 leading-relaxed mt-1 line-clamp-2">{a.summary}</p>}
              </div>
            ))}
          </div>
        )}

        <div className="mt-8">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> トップに戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
