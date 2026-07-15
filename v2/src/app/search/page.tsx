import type { Metadata } from 'next';
import Link from 'next/link';
import { searchAll } from '@/app/actions';
import { ArticleListView } from '@/components/ArticleListView';
import { SearchBox } from '@/components/SearchBox';

// 検索結果ページ（共有・履歴・JS無しでも動く）。クライアント専用の SearchPalette を補完する全画面版。
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string }> }): Promise<Metadata> {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  // 検索結果ページは noindex（薄い/無限ページのindexを避けるSEOの定石）。URL共有は可能。
  return { title: q ? `「${q}」の検索結果` : '検索', robots: { index: false, follow: true } };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  // 「一致した記事」(語彙検索)と「関連する記事」(意味検索)は別々に出す。
  // 1つのリストに順位融合すると両方の精度が落ちることを実測済み（2026-07-15・nDCG 87.5%→84%）。
  // searchAll は内部で語彙検索を1回だけ実行し両レーンで共有する（往復を二重にしない）。
  const { matches: articles, related } = q.length >= 2
    ? await searchAll(q)
    : { matches: [], related: [] };

  return (
    <ArticleListView
      kicker="Search"
      title={q ? `「${q}」` : '検索'}
      articles={articles}
      topSlot={<SearchBox q={q} />}
      emptyText={q.length < 2 ? 'キーワードを入力してください（2文字以上）。' : `「${q}」に一致する記事は見つかりませんでした。`}
      bottomSlot={related.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-bold text-slate-200">関連する記事</h2>
          <p className="text-[11px] text-slate-500 mt-1">検索語そのものは入っていないが、内容が近い記事。</p>
          <div className="mt-3 flex flex-col gap-2">
            {related.map((a) => (
              <div key={a.id} className="rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] p-4 transition-colors group relative">
                <div className="flex items-center gap-2 mb-1 font-mono text-[10px]">
                  <span className="text-amber-400/80">★{a.importanceScore ?? 0}</span>
                  {a.sourceValue && <span className="text-slate-600 truncate">· {a.sourceValue}</span>}
                </div>
                <Link href={`/articles/${a.id}`} scroll={false} className="absolute inset-0" aria-label={a.titleJa || a.title || '記事'} />
                <p className="text-sm font-bold text-slate-100 leading-snug group-hover:text-white transition-colors">{a.titleJa || a.title || '無題'}</p>
                {a.summary && <p className="text-[12px] text-slate-400 leading-relaxed mt-1 line-clamp-2">{a.summary}</p>}
              </div>
            ))}
          </div>
        </section>
      ) : undefined}
    />
  );
}
