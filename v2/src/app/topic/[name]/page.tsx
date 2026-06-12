import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { BrainCircuit, ArrowLeft, BookOpen, Trophy, Network, Sparkles, ArrowRight } from 'lucide-react';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { getEntityKnowledgePage } from '@/app/actions';
import { JsonLd } from '@/components/JsonLd';

const RELATION_LABEL: Record<string, string> = {
  outperforms: '性能で上回る', supersedes: '置き換え', competes_with: '競合',
  builds_on: '基づく', acquired_by: '買収', cites: '引用',
};

// getEntityKnowledgePage は generateMetadata と本体で2回呼ばれるため、リクエスト内でキャッシュ（6クエリの二重実行を防ぐ）
const getTopic = cache((name: string) => getEntityKnowledgePage(name));

function isEmpty(p: Awaited<ReturnType<typeof getTopic>>): boolean {
  return !p || (p.benchmarks.length === 0 && p.relations.length === 0 && p.claims.length === 0 && p.articles.length === 0);
}

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const page = await getTopic(decoded);
  // 中身が無いエンティティは薄いページの量産になるので noindex（リンク追跡は許可）
  if (isEmpty(page)) return { title: decoded, robots: { index: false, follow: true } };
  const desc = `${decoded}${page!.type ? `（${page!.type}）` : ''} の関連レポート・ベンチマーク・関係性を ${SITE_NAME} の知識グラフから。`;
  return {
    title: decoded,
    description: desc,
    openGraph: { title: decoded, description: desc, type: 'article', url: `/topic/${encodeURIComponent(decoded)}` },
    twitter: { card: 'summary_large_image', title: decoded, description: desc },
  };
}

function Section({ icon, title, color, children }: { icon: React.ReactNode; title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
      <p className="text-[11px] font-bold mb-3 flex items-center gap-1.5" style={{ color }}>{icon}{title}</p>
      {children}
    </div>
  );
}

export default async function TopicPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const page = await getTopic(decoded);
  if (!page) notFound();
  const empty = isEmpty(page);

  // パンくず構造化データ（トップ > トピック > 名前）
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: decoded, item: `${SITE_URL}/topic/${encodeURIComponent(decoded)}` },
    ],
  };

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumb} />
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
        <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-cyan-400/80 flex items-center gap-1.5"><BookOpen size={12} />Topic</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-outfit leading-tight mt-2 flex items-center gap-2.5 flex-wrap">
          {decoded}
          {page.type && <span className="font-mono text-[11px] text-cyan-300 border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 rounded">{page.type}</span>}
        </h1>

        {empty ? (
          <p className="text-sm text-slate-400 leading-relaxed mt-6">このトピックの詳細情報はまだありません。{SITE_NAME} が新しいレポートを集めるにつれて蓄積されます。</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 mt-6">
            {page.benchmarks.length > 0 && (
              <Section icon={<Trophy size={13} />} title="ベンチマーク" color="#fcd34d">
                <div className="flex flex-col gap-1.5">
                  {page.benchmarks.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px]">
                      <span className="text-slate-300 truncate flex-1">{b.benchmark}</span>
                      <span className="font-mono text-amber-300">{b.score}{b.unit ?? ''}</span>
                      {b.date && <span className="font-mono text-[10px] text-slate-600">{b.date}</span>}
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {page.relations.length > 0 && (
              <Section icon={<Network size={13} />} title="関係" color="#a5b4fc">
                <div className="flex flex-col gap-1.5">
                  {page.relations.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[13px]">
                      <span className="font-mono text-[10px] text-slate-500 shrink-0">{RELATION_LABEL[r.type] ?? r.type}</span>
                      <ArrowRight size={12} className={`text-indigo-400 shrink-0 ${r.dir === 'in' ? 'rotate-180' : ''}`} />
                      <Link href={`/topic/${encodeURIComponent(r.other)}`} scroll={false} className="truncate text-slate-200 hover:text-cyan-300 transition-colors">
                        {r.other}
                      </Link>
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {page.claims.length > 0 && (
              <Section icon={<Sparkles size={13} />} title="判明している事実" color="#6ee7b7">
                <div className="flex flex-col gap-1.5">
                  {page.claims.map((c, i) => (
                    <div key={i} className="text-[13px] text-slate-300"><span className="text-slate-500">{c.predicate}:</span> {c.value}</div>
                  ))}
                </div>
              </Section>
            )}
            {page.articles.length > 0 && (
              <Section icon={<BookOpen size={13} />} title="関連レポート・記事" color="#7dd3fc">
                <div className="flex flex-col gap-1">
                  {page.articles.map((a) => (
                    <Link key={a.id} href={`/articles/${a.id}`} scroll={false}
                      className="flex items-center gap-2 text-[13px] text-slate-300 hover:text-white rounded px-1.5 py-1 hover:bg-white/5 transition-colors group">
                      <span className="truncate flex-1">{a.title}</span>
                      <span className="font-mono text-[10px] text-slate-600 shrink-0">★{a.importance}</span>
                      <ArrowRight size={12} className="text-slate-600 group-hover:text-sky-400 shrink-0" />
                    </Link>
                  ))}
                </div>
              </Section>
            )}
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
