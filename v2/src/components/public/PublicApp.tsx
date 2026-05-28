"use client";

import React, { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { BrainCircuit, LogIn, LogOut, FileText, ArrowRight, Hash, Newspaper, Sparkles, Search, Bookmark } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/Toast';
import {
  getCoreData, getCollectedDataList, getReportById,
  getRecommendations, getMyReadLater, getReadingProfile,
  toggleFavorite, toggleReadLater, markAsRead,
} from '@/app/actions';
import { ArticleDetailModal } from '@/components/ArticleDetailModal';
import { EntityPageModal } from '@/components/EntityPageModal';
import { ReportModal } from '@/components/public/ReportModal';
import { SearchPalette } from '@/components/public/SearchPalette';
import { ProfileModal } from '@/components/public/ProfileModal';
import { SavedItemsModal } from '@/components/public/SavedItemsModal';
import type { CollectedItem, Report, ReadingProfile } from '@/types';

const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': '#38bdf8', 'エージェント': '#818cf8', 'ツール/フレームワーク': '#34d399',
  'ハードウェア': '#fb923c', 'ビジネス応用': '#f472b6', '研究/論文': '#a78bfa', 'その他': '#475569',
};

const PAGE = 30;

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (h < 1) return 'たった今';
  if (h < 24) return `${h}時間前`;
  if (d < 7) return `${d}日前`;
  return new Date(dateStr).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

// レポートのMarkdownから本文リード（先頭の段落）を抽出
function reportLead(content: string, max = 200): string {
  const body = content.split('\n')
    .filter(l => l.trim() && !/^#{1,6}\s/.test(l) && !/^[-=*]{3,}$/.test(l));
  const text = body.join(' ')
    .replace(/\[ID:\d+\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// 公開トップで使うエディトリアル型の記事カード
function PubCard({ item, onOpen, featured = false }: {
  item: CollectedItem; onOpen: (id: number) => void; featured?: boolean;
}) {
  const color = CATEGORY_COLORS[item.category ?? ''] ?? '#475569';
  const title = item.titleJa || item.title || '無題';
  const outlets = item.storyOutlets ?? [];
  const multi = (item.storyCount ?? 1) > 1 && outlets.length > 0;
  return (
    <article onClick={() => onOpen(item.id)}
      className="group cursor-pointer rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition-colors p-5 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] font-bold tracking-widest uppercase" style={{ color }}>
          {item.category ?? 'OTHER'}
        </span>
        {multi && (
          <span title={outlets.join('、')}
            className="flex items-center gap-0.5 font-mono text-[10px] text-cyan-300/90">
            <Newspaper size={10} />{outlets.length}媒体が報じた
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-slate-600">{timeAgo(item.publishedAt ?? item.createdAt)}</span>
      </div>
      <h3 className={`font-bold leading-snug text-white group-hover:text-sky-300 transition-colors ${featured ? 'text-lg' : 'text-base'}`}>
        {title}
      </h3>
      {item.summary && (
        <p className={`text-sm text-slate-400 leading-relaxed ${featured ? 'line-clamp-3' : 'line-clamp-2'}`}>
          {item.summary}
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] text-slate-600 mt-0.5">
        {item.tags?.slice(0, 3).map(t => <span key={t}>#{t}</span>)}
        {item.sourceValue && <span className="ml-auto truncate max-w-[50%]" style={{ color: `${color}90` }}>{item.sourceValue}</span>}
      </div>
    </article>
  );
}

export function PublicApp() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const sessionUserId = (session?.user as { id?: number } | undefined)?.id;

  const [collectedItems, setCollectedItems] = useState<CollectedItem[]>([]);
  const [reportsList, setReportsList] = useState<Report[]>([]);
  const [recommendations, setRecommendations] = useState<CollectedItem[]>([]);
  const [readLater, setReadLater] = useState<CollectedItem[]>([]);
  const [readingProfile, setReadingProfile] = useState<ReadingProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [detailArticleId, setDetailArticleId] = useState<number | null>(null);
  const [detailEntityName, setDetailEntityName] = useState<string | null>(null);
  const [openReport, setOpenReport] = useState<Report | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // URL ↔ モーダル状態の同期（シェア用ディープリンク）
  const updateUrl = (article: number | null, report: number | null) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (article) { url.searchParams.set('article', String(article)); url.searchParams.delete('report'); }
    else if (report) { url.searchParams.set('report', String(report)); url.searchParams.delete('article'); }
    else { url.searchParams.delete('article'); url.searchParams.delete('report'); }
    window.history.replaceState({}, '', url.pathname + url.search);
  };

  const openArticle = (id: number) => { setDetailArticleId(id); updateUrl(id, null); };
  const closeArticle = () => { setDetailArticleId(null); updateUrl(null, null); };
  const openReportObj = (r: Report) => { setOpenReport(r); updateUrl(null, r.id); };
  const closeReport = () => { setOpenReport(null); updateUrl(null, null); };

  // 初回マウント時にURLからモーダルを復元（シェアされたURLで直接開ける）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const aid = Number(sp.get('article'));
    const rid = Number(sp.get('report'));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isFinite(aid) && aid > 0) setDetailArticleId(aid);
    if (Number.isFinite(rid) && rid > 0) {
      getReportById(rid).then(r => { if (r) setOpenReport(r); }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // パーソナライズの再取得（プロフィール保存後など）
  const reloadPersonalization = async () => {
    if (!sessionUserId) return;
    const [recs, rl, prof] = await Promise.all([getRecommendations(), getMyReadLater(), getReadingProfile()]);
    setRecommendations(recs as CollectedItem[]);
    setReadLater(rl as CollectedItem[]);
    setReadingProfile(prof as ReadingProfile | null);
  };

  // ⌘K / Ctrl+K でグローバル検索を開く
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const { data, reportsData } = await getCoreData(PAGE);
      if (cancelled) return;
      const first = data as CollectedItem[];
      setCollectedItems(first);
      setOffset(first.length);
      setHasMore(first.length === PAGE);
      setReportsList(reportsData as Report[]);
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ログインユーザー向けパーソナライズ（行動ベース推薦・後で読む・読書DNA）。
  // 未ログインでは何も出さない。手動の興味設定に依存しない getRecommendations を使う。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!sessionUserId) { setRecommendations([]); setReadLater([]); setReadingProfile(null); return; }
    let cancelled = false;
    Promise.all([getRecommendations(), getMyReadLater(), getReadingProfile()])
      .then(([recs, rl, prof]) => {
        if (cancelled) return;
        setRecommendations(recs as CollectedItem[]);
        setReadLater(rl as CollectedItem[]);
        setReadingProfile(prof as ReadingProfile | null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionUserId]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = (await getCollectedDataList(PAGE, offset)) as CollectedItem[];
      setCollectedItems(prev => {
        const seen = new Set(prev.map(i => i.id));
        return [...prev, ...next.filter(i => !seen.has(i.id))];
      });
      setOffset(o => o + next.length);
      setHasMore(next.length === PAGE);
    } finally {
      setLoadingMore(false);
    }
  };

  // ログインが要る操作はトースト＋ログイン誘導
  const requireLogin = (msg: string) => { toast(msg, 'info'); signIn('google'); };

  const handleToggleFavorite = async (id: number, current: boolean) => {
    if (!sessionUserId) return requireLogin('お気に入りの保存にはログインが必要です');
    setCollectedItems(prev => prev.map(i => i.id === id ? { ...i, isFavorited: current ? 0 : 1 } : i));
    await toggleFavorite(id, current);
  };
  const handleToggleReadLater = async (id: number, current: boolean) => {
    if (!sessionUserId) return requireLogin('「後で読む」の保存にはログインが必要です');
    setCollectedItems(prev => prev.map(i => i.id === id ? { ...i, isReadLater: current ? 0 : 1 } : i));
    // 「後で読む」一覧も同期（解除なら除外、追加なら一覧へ）
    if (current) {
      setReadLater(prev => prev.filter(i => i.id !== id));
    } else {
      const found = collectedItems.find(i => i.id === id) ?? recommendations.find(i => i.id === id);
      if (found && !readLater.some(i => i.id === id)) setReadLater(prev => [{ ...found, isReadLater: 1 }, ...prev]);
    }
    await toggleReadLater(id, current);
  };
  const handleMarkAsRead = async (id: number, current: boolean) => {
    if (!sessionUserId) return; // 未ログインは静かに無視（閲覧は自由）
    setCollectedItems(prev => prev.map(i => i.id === id ? { ...i, isRead: current ? 0 : 1 } : i));
    await markAsRead(id, current);
  };

  const heroReport = reportsList.find(r => r.type === 'daily') ?? reportsList[0] ?? null;
  // カテゴリ絞り込み中はそのカテゴリの記事のみを対象に。featuredと最新の二分割もカテゴリ内で行う
  const filteredItems = selectedCategory
    ? collectedItems.filter(i => i.category === selectedCategory)
    : collectedItems;
  const featured = [...filteredItems]
    .sort((a, b) => (b.importanceScore ?? 0) - (a.importanceScore ?? 0))
    .slice(0, 6);
  const featuredIds = new Set(featured.map(f => f.id));
  const feed = filteredItems.filter(i => !featuredIds.has(i.id));

  // 注目のテーマ: 直近記事のカテゴリ頻度（タグはHNスコア等のノイズが多いので使わない）
  const catCounts = new Map<string, number>();
  for (const it of collectedItems) { const c = it.category; if (c) catCounts.set(c, (catCounts.get(c) ?? 0) + 1); }
  const themes = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="min-h-screen overflow-y-auto">
      {/* ── トップバー ── */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#03060f]/85 border-b border-white/5">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 sm:px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <BrainCircuit className="text-white" size={15} />
            </div>
            <h1 className="font-bold text-sm font-outfit">AI Tech Researcher</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* 検索: デスクトップは⌘Kヒント付きピル、モバイルはアイコン */}
            <button onClick={() => setSearchOpen(true)} title="記事を検索 (⌘K)"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 text-xs transition-colors">
              <Search size={13} /> 検索
              <span className="font-mono text-[10px] text-slate-600 border border-white/10 rounded px-1">⌘K</span>
            </button>
            <button onClick={() => setSearchOpen(true)} title="記事を検索"
              className="sm:hidden p-1.5 rounded-lg hover:bg-white/10 text-slate-400 transition-colors">
              <Search size={16} />
            </button>
            {session?.user ? (
              <>
                <button onClick={() => setProfileOpen(true)} title="プロフィール"
                  className="flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors">
                  {session.user.image
                    ? <img src={session.user.image} alt="" className="w-6 h-6 rounded-full" />
                    : <div className="w-6 h-6 rounded-full bg-sky-500/20 flex items-center justify-center text-sky-400 text-[10px] font-bold">{(session.user.name ?? '?').slice(0, 1)}</div>}
                  <span className="hidden sm:inline text-[11px] text-slate-300 font-medium">プロフィール</span>
                </button>
                <button onClick={() => signOut()} title="ログアウト"
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-red-400 transition-colors">
                  <LogOut size={14} />
                </button>
              </>
            ) : (
              <button onClick={() => signIn('google')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10 text-sky-400 text-xs font-bold transition-colors">
                <LogIn size={13} /> ログイン
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-10">

        {/* ── 今日のAI（最新レポート要約） ── */}
        {heroReport && (
          <motion.section
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
            onClick={() => openReportObj(heroReport)}
            className="cursor-pointer rounded-3xl border border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.07] to-sky-500/[0.04] p-6 sm:p-8 hover:border-emerald-500/30 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-3 font-mono text-[11px]">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <FileText size={13} /> 今日のAI
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-500">{heroReport.reportDate}</span>
            </div>
            <p className="text-base sm:text-lg text-slate-200 leading-relaxed">
              {reportLead(heroReport.content ?? '', 240) || 'AIの最新動向を自動で集め、要約・分析してお届けします。'}
            </p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-sm font-bold text-emerald-300 group-hover:gap-2.5 transition-all">
              全文を読む <ArrowRight size={15} />
            </span>
          </motion.section>
        )}

        {/* ── あなた向け（ログインユーザー限定・行動ベース） ── */}
        {sessionUserId && (
          <section className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <Sparkles size={16} className="text-indigo-400" />
              <h2 className="text-sm font-bold font-outfit">あなた向け</h2>
              {readingProfile?.persona && (
                <span className="text-[11px] text-slate-500">— {readingProfile.persona}</span>
              )}
            </div>

            {recommendations.length === 0 && readLater.length === 0 && !readingProfile?.persona ? (
              // 初回ログイン直後など、まだ何も溜まっていないときの案内
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 space-y-2">
                <p className="text-sm text-slate-200">まだあなた専用のおすすめは溜まっていません。</p>
                <p className="text-[12px] text-slate-500 leading-relaxed">
                  記事を開いたり「後で読む」「お気に入り」に保存していくと、読み方に合った記事が自動でここに並びます。<br />
                  興味のテーマや目標をプロフィールに書いておくと、さらに精度が上がります。
                </p>
                <div className="pt-1">
                  <button onClick={() => setProfileOpen(true)}
                    className="text-[12px] font-bold text-indigo-300 hover:text-indigo-200 transition-colors">
                    プロフィールを設定 →
                  </button>
                </div>
              </div>
            ) : (
              <>
                {recommendations.length > 0 && (
                  <div>
                    <p className="text-[11px] text-slate-500 mb-2">あなたの読み方に近いおすすめ</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {recommendations.slice(0, 4).map(item => (
                        <PubCard key={item.id} item={item} onOpen={openArticle} />
                      ))}
                    </div>
                  </div>
                )}

                {readLater.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        <Bookmark size={12} /> 後で読む（{readLater.length}）
                      </p>
                      <button onClick={() => setSavedOpen(true)}
                        className="text-[11px] text-indigo-300 hover:text-indigo-200 transition-colors">
                        全部見る →
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {readLater.slice(0, 5).map(item => (
                        <PubCard key={item.id} item={item} onOpen={openArticle} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ── 注目のテーマ（直近記事のタグ頻度） ── */}
        {themes.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3 text-sky-400">
              <Hash size={16} />
              <h2 className="text-sm font-bold font-outfit">注目のテーマ</h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {themes.map(([cat, cnt]) => {
                const color = CATEGORY_COLORS[cat] ?? '#475569';
                const active = selectedCategory === cat;
                return (
                  <button key={cat}
                    onClick={() => setSelectedCategory(active ? null : cat)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition-colors ${active ? 'ring-2 ring-offset-0' : 'hover:bg-white/[0.04]'}`}
                    style={{ borderColor: `${color}${active ? '60' : '28'}`, background: `${color}${active ? '22' : '10'}` }}>
                    <span className="font-bold" style={{ color }}>{cat}</span>
                    <span className="font-mono text-[10px] text-slate-500">{cnt}</span>
                  </button>
                );
              })}
              {selectedCategory && (
                <button onClick={() => setSelectedCategory(null)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] text-slate-400 hover:text-white transition-colors">
                  × フィルタ解除
                </button>
              )}
            </div>
          </section>
        )}

        {/* ── 見どころ ── */}
        {!isLoading && featured.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={16} className="text-sky-400" />
              <h2 className="text-sm font-bold font-outfit">今日の見どころ</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {featured.map(item => (
                <PubCard key={item.id} item={item} onOpen={openArticle} featured />
              ))}
            </div>
          </section>
        )}

        {/* ── 最新の記事 ── */}
        <section>
          <h2 className="text-sm font-bold font-outfit text-slate-300 mb-4">最新の記事</h2>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse" />
              ))}
            </div>
          ) : feed.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-3">
                {feed.map(item => (
                  <PubCard key={item.id} item={item} onOpen={openArticle} />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center pt-6">
                  <button onClick={loadMore} disabled={loadingMore}
                    className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06] text-sm font-bold transition-colors disabled:opacity-40">
                    {loadingMore ? '読み込み中…' : 'もっと読む'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">記事がまだありません。</p>
          )}
        </section>

        <footer className="pt-4 pb-2 text-center font-mono text-[10px] text-slate-700">
          AI Tech Researcher — 毎日「育つ」AIリサーチ
        </footer>
      </main>

      {/* ── モーダル ── */}
      <ArticleDetailModal
        articleId={detailArticleId}
        onClose={closeArticle}
        onToggleFavorite={handleToggleFavorite}
        onToggleReadLater={handleToggleReadLater}
        onMarkAsRead={handleMarkAsRead}
      />
      <EntityPageModal
        entityName={detailEntityName}
        onClose={() => setDetailEntityName(null)}
        onOpenArticle={(id) => { setDetailEntityName(null); openArticle(id); }}
        onOpenEntity={(name) => setDetailEntityName(name)}
      />
      <ReportModal
        report={openReport}
        onClose={closeReport}
        onArticleRef={(id) => { closeReport(); openArticle(id); }}
      />
      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(id) => openArticle(id)}
      />
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSaved={() => { void reloadPersonalization(); }}
      />
      <SavedItemsModal
        open={savedOpen}
        onClose={() => setSavedOpen(false)}
        onOpenArticle={openArticle}
        onToggleReadLater={handleToggleReadLater}
        onToggleFavorite={handleToggleFavorite}
      />
    </div>
  );
}
