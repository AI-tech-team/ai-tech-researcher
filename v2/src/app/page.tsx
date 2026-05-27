"use client";

import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutGrid, Globe, FileText, Settings,
  BarChart3, BrainCircuit, Sparkles, RefreshCw, Network, Telescope, Fingerprint, Layers, LogIn, LogOut, Radar, UserCircle, HelpCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useToast } from '@/components/Toast';
import { ChatPanel } from '@/components/ChatPanel';
import { MobileChatModal } from '@/components/MobileChatModal';
import { OverviewTab } from '@/components/tabs/OverviewTab';
import { DataTab } from '@/components/tabs/DataTab';
import { ReportsTab } from '@/components/tabs/ReportsTab';
import { SettingsTab } from '@/components/tabs/SettingsTab';
import { PerformanceTab } from '@/components/tabs/PerformanceTab';
import { KnowledgeTab } from '@/components/tabs/KnowledgeTab';
import { ResearchTab } from '@/components/tabs/ResearchTab';
import { ReadingDnaTab } from '@/components/tabs/ReadingDnaTab';
import { SignalsTab } from '@/components/tabs/SignalsTab';
import { ProfileTab } from '@/components/tabs/ProfileTab';
import { ArticleDetailModal } from '@/components/ArticleDetailModal';
import { EntityPageModal } from '@/components/EntityPageModal';
import { OnboardingTour } from '@/components/OnboardingTour';
import {
  getCollectedDataList, getCoreData, getAnalyticsData,
  addSource, deleteSource, toggleFavorite, toggleReadLater, markAsRead,
  getSourceROI,
  getKeywordCategoryMatrix, getPipelineLogs,
  getBenchmarkLeaderboards, getKnowledgeRelations, getBenchmarkAlerts, getKnowledgeStats,
  getBriefing, getActiveAlerts, getReadingProfile, getRecommendations, getCrossInsight,
  getSignalIntelligence, type SignalIntel,
  getOwnerStatus, getMyProfile, updateMyProfile,
} from './actions';
import type { CollectedItem, Source, Report, PipelineLog, TrendingKeyword, BenchmarkLeaderboard, KnowledgeRelation, BenchmarkAlert, KnowledgeStats, BriefingReport, AlertItem, ReadingProfile, TopicCluster } from '@/types';

// トップレベルタブ（日次コア=概要/記事、分析系はinsightに集約。後で読むは記事タブ内へ）
type Tab = 'overview' | 'data' | 'reports' | 'insight' | 'settings' | 'profile';
// 分析(insight)配下のサブタブ
type InsightSub = 'knowledge' | 'research' | 'dna' | 'performance' | 'signals';

const TAB_LABELS: Record<Tab, string> = {
  overview: '全体概要',
  data: '記事',
  reports: '調査レポート',
  insight: '分析',
  settings: '設定',
  profile: 'プロフィール',
};
const TAB_SHORT: Record<Tab, string> = {
  overview: '概要', data: '記事', reports: 'レポート', insight: '分析', settings: '設定', profile: 'プロフ',
};

const INSIGHT_SUBS: { id: InsightSub; label: string; icon: React.ReactNode }[] = [
  { id: 'knowledge',   label: '知識グラフ',   icon: <Network size={14} /> },
  { id: 'signals',     label: 'シグナル',     icon: <Radar size={14} /> },
  { id: 'research',    label: '自律リサーチ', icon: <Telescope size={14} /> },
  { id: 'dna',         label: '読書DNA',      icon: <Fingerprint size={14} /> },
  { id: 'performance', label: 'ソース分析',   icon: <BarChart3 size={14} /> },
];
const INSIGHT_LABELS: Record<InsightSub, string> = {
  knowledge: '知識グラフ', signals: 'シグナル', research: '自律リサーチ', dna: '読書DNA', performance: 'ソース分析',
};

const SLIDE = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.15 },
};

// 初見ユーザー向けツアー。各ステップで該当タブを表示しながら説明する。
const TOUR_STEPS: { title: string; body: string; tab: Tab; insightSub?: InsightSub }[] = [
  { title: 'AI Tech Researcher へようこそ', body: 'AIの最新動向を自動で集め、要約・分析して日々「育つ」リサーチ・ダッシュボードです。ログインなしでそのまま閲覧できます。', tab: 'overview' },
  { title: '① 全体概要', body: '今日のハイライトと急上昇トピックが、ここで一目で分かります。まずはここから。', tab: 'overview' },
  { title: '② 記事', body: '収集したAI技術記事の一覧です。重要度順に並び、気になるものを開いて読めます。', tab: 'data' },
  { title: '③ 調査レポート', body: 'AIが毎日まとめる要約レポート。最近の流れや要点を短時間で把握できます。', tab: 'reports' },
  { title: '④ 知識グラフ', body: 'このツールの強みです。長く観測してきた蓄積（ベンチマークの推移・モデル同士の関係）を可視化します。新しく立ち上げたAIには出せない"縦の時間軸"です。', tab: 'insight', insightSub: 'knowledge' },
  { title: 'ログインでもっと便利に', body: 'Googleログインすると、お気に入り保存やAIチャットが使えます（任意）。それでは始めましょう。', tab: 'overview' },
];

export default function Home() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [insightSub, setInsightSub] = useState<InsightSub>('knowledge');
  const [sourcesList, setSourcesList] = useState<Source[]>([]);
  const [collectedItems, setCollectedItems] = useState<CollectedItem[]>([]);
  const [reportsList, setReportsList] = useState<Report[]>([]);
  const [activityData, setActivityData] = useState<{ name: string; count: number }[]>([]);
  const [sourcePerformance, setSourcePerformance] = useState<any[]>([]);
  const [categoryTrendData, setCategoryTrendData] = useState<any[]>([]);
  const [modelMentionData, setModelMentionData] = useState<{ model: string; count: number }[]>([]);
  const [kwMatrix, setKwMatrix] = useState<{ keywords: string[]; categories: string[]; matrix: any[]; maxCount: number }>({
    keywords: [], categories: [], matrix: [], maxCount: 1,
  });
  const [trendingKeywords, setTrendingKeywords] = useState<TrendingKeyword[]>([]);
  const [leaderboards, setLeaderboards] = useState<BenchmarkLeaderboard[]>([]);
  const [knowledgeRelations, setKnowledgeRelations] = useState<KnowledgeRelation[]>([]);
  const [benchmarkAlerts, setBenchmarkAlerts] = useState<BenchmarkAlert[]>([]);
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStats>({ entities: 0, benchmarks: 0, relations: 0, staleRelations: 0 });
  const [briefing, setBriefing] = useState<BriefingReport | null>(null);
  const [crossInsight, setCrossInsight] = useState<BriefingReport | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<AlertItem[]>([]);
  const [readingProfile, setReadingProfile] = useState<ReadingProfile | null>(null);
  const [topicClusters, setTopicClusters] = useState<TopicCluster[]>([]);
  const [recommendations, setRecommendations] = useState<CollectedItem[]>([]);
  const [pipelineLogs, setPipelineLogs] = useState<PipelineLog[]>([]);
  const [signals, setSignals] = useState<SignalIntel | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [loadedGroups, setLoadedGroups] = useState<Record<InsightSub, boolean>>({ knowledge: false, signals: false, research: false, dna: false, performance: false });
  const loadingRef = useRef<Record<string, boolean>>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [interestTags, setInterestTags] = useState<string[]>([]);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [focusArticleId, setFocusArticleId] = useState<number | null>(null);
  const [detailArticleId, setDetailArticleId] = useState<number | null>(null);
  const [detailEntityName, setDetailEntityName] = useState<string | null>(null);
  const [articleCounts, setArticleCounts] = useState<{ total: number; unread: number; favorite: number; readLater: number } | null>(null);
  const [articlesOffset, setArticlesOffset] = useState(0);
  const [hasMoreArticles, setHasMoreArticles] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const ARTICLE_PAGE = 60;
  const [owner, setOwner] = useState<{ isOwner: boolean; passwordConfigured: boolean } | null>(null);
  const isOwner = owner?.isOwner === true;
  const sessionUserId = (session?.user as { id?: number } | undefined)?.id;

  const refreshOwner = () => { getOwnerStatus().then(setOwner).catch(() => setOwner(null)); };
  // オーナー状態はCookie（解錠）＋セッション（id===1フォールバック）に依存するため、ログイン変化で再取得
  useEffect(() => { refreshOwner(); }, [sessionUserId]);
  // 設定タブはオーナー専用。非オーナーが（施錠等で）設定に居たら概要へ退避
  useEffect(() => { if (!isOwner && activeTab === 'settings') setActiveTab('overview'); }, [isOwner, activeTab]);

  useEffect(() => { loadCore(); }, []);

  // 興味はDB(プロフィール)を正とする。未ログインはlocalStorageで従来動作。
  // 初回ログイン時にDBが空でlocalStorageに旧タグがあれば移行→クリア（オーナーの既存タグを失わない）。
  useEffect(() => { loadInterests(); }, [sessionUserId]);

  async function loadInterests() {
    let local: string[] = [];
    try { const s = localStorage.getItem('interestTags'); if (s) local = JSON.parse(s); } catch {}
    const profile = await getMyProfile().catch(() => null);
    if (!profile) { setInterestTags(Array.isArray(local) ? local : []); return; }
    const dbTags = [...new Set((profile.interests ?? '').split(/[,、\s]+/).map(t => t.trim()).filter(Boolean))];
    if (dbTags.length === 0 && local.length > 0) {
      const r = await updateMyProfile({ displayName: profile.displayName, interests: local.join(', '), goals: profile.goals, emailOptIn: profile.emailOptIn }).catch(() => ({ success: false }));
      setInterestTags(local);
      if (r.success) { try { localStorage.removeItem('interestTags'); } catch {} }
    } else {
      setInterestTags(dbTags);
    }
  }

  // Phase 1（記事・ソース）とPhase 2（analytics）を同時発火。
  // Phase 1が先に解決 → 記事を即表示し、グラフはその後に埋まる（9HTTP→2HTTP）
  async function loadCore() {
    setIsLoadingData(true);
    const analyticsPromise = getAnalyticsData();
    const { srcs, data, reportsData, activity, counts } = await getCoreData(ARTICLE_PAGE);
    setSourcesList(srcs as Source[]);
    const first = data as CollectedItem[];
    setCollectedItems(first);
    setArticlesOffset(first.length);
    setHasMoreArticles(first.length === ARTICLE_PAGE);
    setArticleCounts(counts as { total: number; unread: number; favorite: number; readLater: number });
    setReportsList(reportsData as Report[]);
    setActivityData(activity);
    setIsLoadingData(false);
    const { catTrend, modelMentions, trending, clusters } = await analyticsPromise;
    setCategoryTrendData(catTrend);
    setModelMentionData(modelMentions as { model: string; count: number }[]);
    setTrendingKeywords(trending as TrendingKeyword[]);
    setTopicClusters(clusters as TopicCluster[]);
  }

  // 記事の段階ロード（100件上限を撤廃。DBオフセットで全アーカイブを順に取得）
  async function loadMoreArticles() {
    if (isLoadingMore || !hasMoreArticles) return;
    setIsLoadingMore(true);
    try {
      const next = (await getCollectedDataList(ARTICLE_PAGE, articlesOffset)) as CollectedItem[];
      setCollectedItems(prev => {
        const seen = new Set(prev.map(i => i.id));
        return [...prev, ...next.filter(i => !seen.has(i.id))];
      });
      setArticlesOffset(o => o + next.length);
      setHasMoreArticles(next.length === ARTICLE_PAGE);
    } finally {
      setIsLoadingMore(false);
    }
  }

  // どこからでも記事を開ける共通導線（おすすめ/知識グラフ/チャット[ID]等）
  const openArticle = (id: number) => setDetailArticleId(id);
  // どこからでもエンティティ知識ページを開ける共通導線（リーダーボード/関係/シグナル等）
  const openEntity = (name: string) => setDetailEntityName(name);

  // インサイト各グループのデータ取得（実体）
  async function fetchGroup(g: InsightSub) {
    if (g === 'knowledge') {
      const [lbs, krels, balerts, kstats] = await Promise.all([
        getBenchmarkLeaderboards(), getKnowledgeRelations(), getBenchmarkAlerts(), getKnowledgeStats(),
      ]);
      setLeaderboards(lbs as BenchmarkLeaderboard[]);
      setKnowledgeRelations(krels as KnowledgeRelation[]);
      setBenchmarkAlerts(balerts as BenchmarkAlert[]);
      setKnowledgeStats(kstats as KnowledgeStats);
    } else if (g === 'research') {
      const [brief, aalerts, ci] = await Promise.all([getBriefing(), getActiveAlerts(), getCrossInsight()]);
      setBriefing(brief as BriefingReport | null);
      setActiveAlerts(aalerts as AlertItem[]);
      setCrossInsight(ci as BriefingReport | null);
    } else if (g === 'dna') {
      const [prof, recs] = await Promise.all([getReadingProfile(), getRecommendations()]);
      setReadingProfile(prof as ReadingProfile | null);
      setRecommendations(recs as CollectedItem[]);
    } else if (g === 'performance') {
      const [perf, matrix, logs] = await Promise.all([getSourceROI(), getKeywordCategoryMatrix(), getPipelineLogs()]);
      setSourcePerformance(perf as any[]);
      setKwMatrix(matrix as any);
      setPipelineLogs(logs);
    } else if (g === 'signals') {
      setSignals(await getSignalIntelligence());
    }
    setLoadedGroups(prev => ({ ...prev, [g]: true }));
  }

  // 未取得なら取得（重複防止）
  async function ensureGroup(g: InsightSub) {
    if (loadedGroups[g] || loadingRef.current[g]) return;
    loadingRef.current[g] = true;
    try { await fetchGroup(g); } finally { loadingRef.current[g] = false; }
  }

  // 変更後の再読込: コア＋既に開いたグループを最新化
  async function refresh() {
    await loadCore();
    const opened = (Object.keys(loadedGroups) as InsightSub[]).filter(g => loadedGroups[g]);
    await Promise.all(opened.map(fetchGroup));
  }

  const selectTab = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === 'insight') ensureGroup(insightSub);
  };
  const selectInsight = (sub: InsightSub) => {
    setInsightSub(sub);
    ensureGroup(sub);
  };

  // ── 初見ユーザー向けツアー ──
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  // 初回訪問時のみ自動起動（マウント後にlocalStorageを読む＝hydration安全）
  useEffect(() => {
    try { if (!localStorage.getItem('onboarding_v1_done')) { setTourStep(0); setTourActive(true); } } catch {}
  }, []);
  // ツアー中は現在ステップの該当タブを表示
  useEffect(() => {
    if (!tourActive) return;
    const s = TOUR_STEPS[tourStep];
    if (!s) return;
    setActiveTab(s.tab);
    if (s.insightSub) { setInsightSub(s.insightSub); ensureGroup(s.insightSub); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourActive, tourStep]);
  const endTour = () => {
    try { localStorage.setItem('onboarding_v1_done', '1'); } catch {}
    setTourActive(false); setTourStep(0); setActiveTab('overview');
  };
  const tourNext = () => { if (tourStep >= TOUR_STEPS.length - 1) endTour(); else setTourStep(s => s + 1); };
  const tourBack = () => setTourStep(s => Math.max(0, s - 1));
  const startTour = () => { setTourStep(0); setTourActive(true); };
  // 最終ステップの「ログインして始める」: ツアー完了を記録してGoogleログインへ
  const tourLogin = () => { try { localStorage.setItem('onboarding_v1_done', '1'); } catch {} setTourActive(false); signIn('google'); };

  const handleSyncData = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/collect', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        await refresh();
        toast(result.message ?? 'データ同期が完了しました', 'success');
      } else {
        toast(`同期エラー: ${result.message ?? '不明なエラー'}`, 'error');
      }
    } catch {
      toast('通信エラーが発生しました', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleFavorite = async (id: number, currentlyFavorited: boolean) => {
    if (!sessionUserId) { toast('お気に入りの保存にはログインが必要です', 'info'); signIn('google'); return; }
    setCollectedItems(prev => prev.map(item => item.id === id ? { ...item, isFavorited: currentlyFavorited ? 0 : 1 } : item));
    setArticleCounts(c => c && { ...c, favorite: Math.max(0, c.favorite + (currentlyFavorited ? -1 : 1)) });
    toast(currentlyFavorited ? 'お気に入りを解除しました' : '⭐ お気に入りに追加しました', 'success');
    await toggleFavorite(id, currentlyFavorited);
  };

  // 他タブのおすすめ等から記事タブの該当記事へジャンプ
  const navigateToArticle = (id: number) => {
    setActiveTab('data');
    setFocusArticleId(id);
  };

  const handleToggleReadLater = async (id: number, current: boolean) => {
    if (!sessionUserId) { toast('「後で読む」の保存にはログインが必要です', 'info'); signIn('google'); return; }
    setCollectedItems(prev => prev.map(item => item.id === id ? { ...item, isReadLater: current ? 0 : 1 } : item));
    setArticleCounts(c => c && { ...c, readLater: Math.max(0, c.readLater + (current ? -1 : 1)) });
    toast(current ? '「後で読む」を解除しました' : '🔖 「後で読む」に追加しました', 'success');
    await toggleReadLater(id, current);
  };

  const handleMarkAsRead = async (id: number, currentIsRead: boolean) => {
    setCollectedItems(prev => prev.map(item => item.id === id ? { ...item, isRead: currentIsRead ? 0 : 1 } : item));
    setArticleCounts(c => c && { ...c, unread: Math.max(0, c.unread + (currentIsRead ? 1 : -1)) });
    await markAsRead(id, currentIsRead);
  };

  const handleAddSource = async (keyword: string) => {
    await addSource(keyword);
    await refresh();
  };

  const handleDeleteSource = async (id: number) => {
    await deleteSource(id);
    await refresh();
  };

  const handleEvolve = async () => {
    const res = await fetch('/api/evolve', { method: 'POST' });
    const result = await res.json();
    if (!result.success) throw new Error(result.message ?? '不明なエラー');
    await refresh();
  };

  const unreadCount = collectedItems.filter(i => !i.isRead).length;
  const currentLabel = activeTab === 'insight' ? INSIGHT_LABELS[insightSub] : TAB_LABELS[activeTab];

  // 設定タブはオーナーにのみ表示する
  const navItems: [Tab, React.ReactNode, string][] = [
    ['overview', <LayoutGrid key="overview" size={19} />, '全体概要'],
    ['data', <Globe key="data" size={19} />, `記事${unreadCount > 0 ? ` (未読${unreadCount})` : ''}`],
    ['reports', <FileText key="reports" size={19} />, '調査レポート'],
    ['insight', <Layers key="insight" size={19} />, '分析'],
    ['settings', <Settings key="settings" size={19} />, '設定'],
    ['profile', <UserCircle key="profile" size={19} />, 'プロフィール'],
  ].filter(([tab]) => (tab !== 'settings' || isOwner) && (!tourActive || ['overview', 'data', 'reports', 'insight'].includes(tab as string))) as [Tab, React.ReactNode, string][];
  const mobileNavItems: [Tab, React.ReactNode][] = [
    ['overview', <LayoutGrid key="overview" size={21} />],
    ['data', <Globe key="data" size={21} />],
    ['reports', <FileText key="reports" size={21} />],
    ['insight', <Layers key="insight" size={21} />],
    ['settings', <Settings key="settings" size={21} />],
    ['profile', <UserCircle key="profile" size={21} />],
  ].filter(([tab]) => (tab !== 'settings' || isOwner) && (!tourActive || ['overview', 'data', 'reports', 'insight'].includes(tab as string))) as [Tab, React.ReactNode][];

  const insightLoading = !loadedGroups[insightSub];

  const tabContent = (
    <AnimatePresence mode="wait">
      {activeTab === 'overview' && (
        <motion.div key="overview" {...SLIDE}>
          <OverviewTab sourcesList={sourcesList} collectedItems={collectedItems} reportsList={reportsList}
            activityData={activityData} categoryTrendData={categoryTrendData} modelMentionData={modelMentionData}
            trendingKeywords={trendingKeywords}
            topicClusters={topicClusters} isLoadingData={isLoadingData} />
        </motion.div>
      )}
      {activeTab === 'data' && (
        <motion.div key="data" {...SLIDE}>
          <DataTab collectedItems={collectedItems} isLoadingData={isLoadingData}
            interestTags={interestTags}
            counts={articleCounts}
            hasMore={hasMoreArticles} onLoadMore={loadMoreArticles} isLoadingMore={isLoadingMore}
            onOpenArticle={openArticle}
            onToggleFavorite={handleToggleFavorite} onToggleReadLater={handleToggleReadLater}
            onMarkAsRead={handleMarkAsRead}
            focusArticleId={focusArticleId} onClearFocus={() => setFocusArticleId(null)} />
        </motion.div>
      )}
      {activeTab === 'reports' && (
        <motion.div key="reports" {...SLIDE}>
          <ReportsTab reportsList={reportsList} isLoadingData={isLoadingData}
            collectedItemsCount={collectedItems.length} onReload={refresh} />
        </motion.div>
      )}
      {activeTab === 'insight' && (
        <motion.div key="insight" {...SLIDE} className="space-y-5">
          {/* サブナビ（知識/リサーチ/DNA/分析） */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {INSIGHT_SUBS.map(s => (
              <button key={s.id} onClick={() => selectInsight(s.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${insightSub === s.id ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>
                {s.icon}{s.label}
              </button>
            ))}
          </div>
          {insightSub === 'knowledge' && (
            <KnowledgeTab leaderboards={leaderboards} relations={knowledgeRelations}
              alerts={benchmarkAlerts} stats={knowledgeStats} isLoadingData={insightLoading}
              onOpenEntity={openEntity} />
          )}
          {insightSub === 'signals' && (
            <SignalsTab signals={signals} isLoadingData={insightLoading} onOpenEntity={openEntity} interestTags={interestTags} />
          )}
          {insightSub === 'research' && (
            <ResearchTab briefing={briefing} crossInsight={crossInsight} alerts={activeAlerts}
              isLoadingData={insightLoading} onReload={refresh} />
          )}
          {insightSub === 'dna' && (
            <ReadingDnaTab profile={readingProfile} recommendations={recommendations} isLoadingData={insightLoading}
              onNavigateToArticle={openArticle} />
          )}
          {insightSub === 'performance' && (
            <PerformanceTab sourcesList={sourcesList} collectedItems={collectedItems}
              sourcePerformance={sourcePerformance} kwMatrix={kwMatrix}
              pipelineLogs={pipelineLogs} isLoadingData={insightLoading} />
          )}
        </motion.div>
      )}
      {activeTab === 'settings' && isOwner && (
        <motion.div key="settings" {...SLIDE}>
          <SettingsTab sourcesList={sourcesList} isLoadingData={isLoadingData}
            isOwner={isOwner}
            onAddSource={handleAddSource} onDeleteSource={handleDeleteSource}
            onEvolve={handleEvolve} onReload={refresh} />
        </motion.div>
      )}
      {activeTab === 'profile' && (
        <motion.div key="profile" {...SLIDE}>
          <ProfileTab
            onInterestsChange={setInterestTags}
            onOwnerChange={() => { refreshOwner(); refresh(); }}
            onNavigateToDna={() => { setActiveTab('insight'); selectInsight('dna'); }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-48 border-r border-white/5 px-3 py-4 flex-col gap-5 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-2 pt-1">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 flex-shrink-0">
            <BrainCircuit className="text-white" size={15} />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-sm font-outfit leading-tight truncate">AI Researcher</h2>
            <span className="font-mono text-[9px] text-sky-500/70 tracking-widest">v4.5</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5">
          {navItems.map(([tab, icon, label]) => (
            <button key={tab} onClick={() => selectTab(tab)}
              className={`sidebar-item ${activeTab === tab ? 'active' : ''}`}>
              {icon}
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>

        {/* Auth + Status */}
        <div className="mt-auto flex flex-col gap-2">
          {/* Googleログイン */}
          {session?.user ? (
            <div onClick={() => selectTab('profile')} title="プロフィールを開く"
              className={`flex items-center gap-2 px-2 py-2 rounded-lg border bg-white/[0.02] cursor-pointer transition-colors ${activeTab === 'profile' ? 'border-sky-500/40 bg-sky-500/5' : 'border-white/5 hover:bg-white/5'}`}>
              {session.user.image
                ? <img src={session.user.image} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
                : <div className="w-6 h-6 rounded-full bg-sky-500/20 flex items-center justify-center text-sky-400 text-[10px] font-bold flex-shrink-0">{(session.user.name ?? session.user.email ?? '?').slice(0, 1)}</div>}
              <span className="text-[11px] text-slate-300 truncate flex-1" title={session.user.email ?? ''}>{session.user.name ?? session.user.email}</span>
              <button onClick={(e) => { e.stopPropagation(); signOut(); }} title="ログアウト" className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-red-400 transition-colors flex-shrink-0">
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <button onClick={() => signIn('google')}
              className="flex items-center justify-center gap-2 px-2 py-2 rounded-lg border border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10 text-sky-400 text-xs font-bold transition-colors">
              <LogIn size={13} /> Googleでログイン
            </button>
          )}
          {/* Status */}
          <div className="px-2 py-2 rounded-lg border border-white/5 bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <div className="live-dot" />
              <span className="font-mono text-[10px] text-emerald-500 tracking-widest">ONLINE</span>
            </div>
            <p className="font-mono text-[10px] text-slate-700 mt-1 tracking-wide">
              {collectedItems.length} ARTICLES
            </p>
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto min-w-0 pb-16 md:pb-0">

        {/* Desktop header */}
        <div className="hidden md:flex flex-col gap-3 px-6 pt-5 pb-4 border-b border-white/5">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold font-outfit">{currentLabel}</h1>
            <div className="flex items-center gap-2">
              <button onClick={startTour} title="使い方ツアーを見る"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-300 text-xs hover:bg-white/5 transition-colors">
                <HelpCircle size={13} /> 使い方
              </button>
              {isOwner && (
                <button onClick={handleSyncData} disabled={isSyncing}
                  className={`btn-primary flex items-center gap-1.5 ${isSyncing ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} />
                  {isSyncing ? '同期中' : '同期'}
                </button>
              )}
            </div>
          </div>
          {/* Slim status line */}
          <div className="flex items-center gap-3.5 font-mono text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5 text-emerald-500">
              <div className="live-dot" style={{ width: 4, height: 4 }} />LIVE
            </span>
            <span className="text-slate-600">|</span>
            <span>{collectedItems.length} 記事</span>
            {unreadCount > 0 && <span className="text-sky-400">未読 {unreadCount}</span>}
            {trendingKeywords.length > 0 && <span className="text-orange-400">急上昇 {trendingKeywords.length}</span>}
          </div>
        </div>

        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-white/5 bg-[#03060f]/90 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <div className="live-dot" />
            <span className="font-mono text-[11px] text-slate-400 tracking-wide">{currentLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={startTour} title="使い方ツアーを見る"
              className="p-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors">
              <HelpCircle size={14} />
            </button>
            {isOwner && (
              <button onClick={handleSyncData} disabled={isSyncing}
                className="btn-primary flex items-center gap-1.5 disabled:opacity-40">
                <RefreshCw size={10} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? '同期中...' : '同期'}
              </button>
            )}
          </div>
        </div>

        {/* Tab content */}
        <div className="p-4 md:p-7 md:pt-0">
          {tabContent}
        </div>
      </main>

      {/* ── Desktop Chat Panel（オーナー限定）── */}
      {isOwner && (
        <div className="hidden md:flex">
          <ChatPanel onArticleRef={openArticle} />
        </div>
      )}

      {/* ── Mobile bottom navigation ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-white/10 flex safe-area-inset-bottom">
        {mobileNavItems.map(([tab, icon]) => {
          const isActive = activeTab === tab;
          const count = tab === 'data' && unreadCount > 0 ? unreadCount : null;
          return (
            <button
              key={tab}
              onClick={() => selectTab(tab)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 relative transition-colors ${isActive ? 'text-sky-400' : 'text-slate-500'}`}
            >
              {count != null && (
                <span className="absolute top-1.5 right-1/4 w-4 h-4 bg-sky-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                  {count > 9 ? '9+' : count}
                </span>
              )}
              <span className={isActive ? 'scale-110 transition-transform' : ''}>{icon}</span>
              <span className="text-[9px] font-medium">{TAB_SHORT[tab]}</span>
              {isActive && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-sky-400 rounded-full" />}
            </button>
          );
        })}
      </nav>

      {/* ── Mobile floating chat button（オーナー限定）── */}
      {isOwner && (
        <button
          onClick={() => setMobileChatOpen(true)}
          className="md:hidden fixed bottom-20 right-4 z-40 w-12 h-12 rounded-full bg-gradient-to-br from-sky-500 to-purple-500 flex items-center justify-center shadow-lg shadow-purple-500/30 active:scale-95 transition-transform"
          aria-label="Geminiチャットを開く"
        >
          <Sparkles size={20} className="text-white" />
        </button>
      )}

      {/* ── Mobile chat modal ── */}
      {isOwner && <MobileChatModal isOpen={mobileChatOpen} onClose={() => setMobileChatOpen(false)} onArticleRef={openArticle} />}

      {/* ── 記事詳細モーダル（おすすめ/知識グラフ/チャット[ID]等の共通ジャンプ先）── */}
      <ArticleDetailModal
        articleId={detailArticleId}
        onClose={() => setDetailArticleId(null)}
        onToggleFavorite={handleToggleFavorite}
        onToggleReadLater={handleToggleReadLater}
        onMarkAsRead={handleMarkAsRead}
        onShowInList={(id) => { setDetailArticleId(null); navigateToArticle(id); }}
      />

      {/* ── エンティティ知識ページ（知識グラフ/シグナル等の共通ジャンプ先）── */}
      <EntityPageModal
        entityName={detailEntityName}
        onClose={() => setDetailEntityName(null)}
        onOpenArticle={(id) => { setDetailEntityName(null); openArticle(id); }}
        onOpenEntity={openEntity}
      />

      {/* ── 初見ユーザー向けツアー ── */}
      {tourActive && TOUR_STEPS[tourStep] && (
        <OnboardingTour
          step={tourStep}
          total={TOUR_STEPS.length}
          title={TOUR_STEPS[tourStep].title}
          body={TOUR_STEPS[tourStep].body}
          isLast={tourStep >= TOUR_STEPS.length - 1}
          onNext={tourNext}
          onBack={tourBack}
          onSkip={endTour}
          onLogin={tourLogin}
        />
      )}
    </div>
  );
}
