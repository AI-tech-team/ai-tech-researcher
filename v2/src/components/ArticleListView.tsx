import Link from 'next/link';
import type { CollectedItem } from '@/types';
import { noSummaryShort } from '@/lib/no-summary';
import { CATEGORY_COLORS } from '@/lib/category-colors';
import { ObservedFacts } from '@/components/public/ObservedFacts';
import { BrandNav, BrandFooter } from '@/components/digest/BrandChrome';
import s from '@/styles/brand.module.css';

// カテゴリ/タグの記事一覧ページ本体（サーバ描画）。/category/[name] と /tag/[name] で共用。
// 各記事は /articles/[id] への本物リンク。公開SEOページなのでユーザー状態は扱わない。
//
// 2026-09-12: 記事一覧（/articles）と同じ「罫で仕切る川」に揃えた。同じ内容の一覧が
// 入口によって箱組みとリスト組みに分かれていたので、読者には別のサイトに見えていた。

export function ArticleListView({ kicker, title, articles, topSlot, emptyText, paginationSlot, bottomSlot }: {
  kicker: string; title: string; articles: CollectedItem[];
  topSlot?: React.ReactNode;        // 見出し下に差し込む要素（検索ボックス等）
  emptyText?: string;
  paginationSlot?: React.ReactNode; // 一覧の下に差し込むページ送り
  bottomSlot?: React.ReactNode;     // 一覧の下に差し込む別セクション（検索の「関連する記事」等）
}) {
  return (
    <div className="min-h-screen">
      <BrandNav />

      <main id="main-content" className={`${s.listShell} pb-24`}>
        <section className={s.listHead}>
          <p className={s.listEyebrow}>{kicker}</p>
          <h1 className={s.listTitle}>{title}</h1>
          <p className={s.listLead}>{articles.length}件</p>
        </section>

        {topSlot && <div className={s.listSection}>{topSlot}</div>}

        {articles.length === 0 ? (
          <p className={s.listLead}>{emptyText ?? '該当する記事がまだありません。'}</p>
        ) : (
          <div className={`${s.river} ${s.listSection}`}>
            {articles.map((a) => (
              <div key={a.id} className={s.riverItem} style={{ position: 'relative' }}>
                <div className={s.riverTop}>
                  {a.category && (
                    <Link href={`/category/${encodeURIComponent(a.category)}`} scroll={false}
                      className={s.riverCat} style={{ color: CATEGORY_COLORS[a.category] ?? 'var(--cat-other)', position: 'relative', zIndex: 1 }}>
                      {a.category}
                    </Link>
                  )}
                  {/* 決定④: ★ではなく数えただけの事実（ObservedFacts.tsx の先頭コメントに理由） */}
                  <ObservedFacts item={a} className={s.riverTime} />
                </div>
                {/* 行全体を記事へのリンクに（カテゴリリンクは上の z-index で優先） */}
                <Link href={`/articles/${a.id}`} scroll={false} className="absolute inset-0" aria-label={a.titleJa || a.title || '記事'} />
                <h2 className={s.riverTitle}>{a.titleJa || a.title || '無題'}</h2>
                {a.summary
                  ? <p className={s.riverSummary}>{a.summary}</p>
                  /* 要約が無いときは空欄にせず理由を1行で（src/lib/no-summary.ts）。警告色は使わない */
                  : <p className={s.riverNote}>{noSummaryShort(a)}</p>}
                {a.sourceValue && (
                  <div className={s.riverFoot}><span className={s.riverSource}>{a.sourceValue}</span></div>
                )}
              </div>
            ))}
          </div>
        )}

        {paginationSlot}

        {bottomSlot}
      </main>

      <BrandFooter />
    </div>
  );
}
