import type { Metadata } from 'next';
import Link from 'next/link';
import { BrainCircuit, ArrowLeft, BookOpen } from 'lucide-react';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { getTopicIndex } from '@/app/actions';
import { JsonLd } from '@/components/JsonLd';

// トピック一覧。ここが無いと /topic/[name] へはサイト内から到達できず、sitemap と
// 記事内リンクだけが入口になっていた（[[public-ui-overhaul]] の「在アプリ導線が無い」）。
// 掲載対象は entity-quality の基準を満たすものだけ（一般名詞・文・mention_count=1 を除く）。
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'トピック',
  description: `${SITE_NAME} が追跡しているAIモデル・企業・技術のトピック一覧。言及の多い順に並んでいます。`,
  alternates: { canonical: '/topic' },
  openGraph: {
    title: `トピック — ${SITE_NAME}`,
    description: `${SITE_NAME} が追跡しているAIモデル・企業・技術の一覧。`,
    url: `${SITE_URL}/topic`,
    type: 'website',
  },
};

function Group({ label, hint, items }: { label: string; hint: string; items: { name: string; mentions: number }[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-8">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-white font-outfit">{label}</h2>
        <span className="font-mono text-[10px] text-slate-600">{hint}・{items.length}件</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {items.map((t) => (
          <Link
            key={t.name}
            href={`/topic/${encodeURIComponent(t.name)}`}
            scroll={false}
            className="group flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1.5 text-[13px] text-slate-200 hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-200 transition-colors"
          >
            <span className="truncate max-w-[16rem]">{t.name}</span>
            <span className="font-mono text-[10px] text-slate-600 group-hover:text-cyan-400/70">{t.mentions}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default async function TopicIndexPage() {
  const topics = await getTopicIndex(200);

  const major = topics.filter((t) => t.mentions >= 10);
  const tracked = topics.filter((t) => t.mentions >= 5 && t.mentions < 10);
  const rest = topics.filter((t) => t.mentions < 5);

  // 一覧そのものを ItemList として構造化（クローラに全トピックのURLを渡す）
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `トピック一覧 — ${SITE_NAME}`,
    numberOfItems: topics.length,
    itemListElement: topics.slice(0, 100).map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      url: `${SITE_URL}/topic/${encodeURIComponent(t.name)}`,
    })),
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'トピック', item: `${SITE_URL}/topic` },
    ],
  };

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumb} />
      <JsonLd data={itemList} />
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[var(--bg-color)]/85 border-b border-white/5">
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
        <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-cyan-400/80 flex items-center gap-1.5">
          <BookOpen size={12} />Topics
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-outfit leading-tight mt-2">トピック</h1>
        <p className="text-sm text-slate-400 leading-relaxed mt-3">
          {SITE_NAME} が記事から抽出して追跡している、AIモデル・企業・技術です。数字はこれまでに言及された回数。
        </p>

        {topics.length === 0 ? (
          <p className="text-sm text-slate-400 mt-8">まだトピックがありません。</p>
        ) : (
          <>
            <Group label="よく登場する" hint="10回以上" items={major} />
            <Group label="追跡中" hint="5〜9回" items={tracked} />
            <Group label="その他" hint="2〜4回" items={rest} />
          </>
        )}

        <div className="mt-10">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> トップに戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
