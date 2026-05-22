"use client";

import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutGrid, Globe, Bookmark, FileText, Settings,
  BarChart3, BrainCircuit, Sparkles, RefreshCw, Zap, Network, Telescope, Fingerprint, Layers,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/Toast';
import { ChatPanel } from '@/components/ChatPanel';
import { MobileChatModal } from '@/components/MobileChatModal';
import { OverviewTab } from '@/components/tabs/OverviewTab';
import { DataTab } from '@/components/tabs/DataTab';
import { ReadLaterTab } from '@/components/tabs/ReadLaterTab';
import { ReportsTab } from '@/components/tabs/ReportsTab';
import { SettingsTab } from '@/components/tabs/SettingsTab';
import { PerformanceTab } from '@/components/tabs/PerformanceTab';
import { KnowledgeTab } from '@/components/tabs/KnowledgeTab';
import { ResearchTab } from '@/components/tabs/ResearchTab';
import { ReadingDnaTab } from '@/components/tabs/ReadingDnaTab';
import {
  getSourcesData, getCollectedDataList, getReportsData,
  addSource, deleteSource, getActivityData, toggleFavorite, toggleReadLater, markAsRead,
  getSourceROI, getCategoryTrendData, getModelMentionData,
  getKeywordCategoryMatrix, getTrendingKeywords, getPipelineLogs, getConflictingClaims,
  getBenchmarkLeaderboards, getKnowledgeRelations, getBenchmarkAlerts, getKnowledgeStats,
  getBriefing, getActiveAlerts, getReadingProfile, getTopicClusters, getRecommendations,
} from './actions';
import type { CollectedItem, Source, Report, PipelineLog, TrendingKeyword, ConflictingClaim, BenchmarkLeaderboard, KnowledgeRelation, BenchmarkAlert, KnowledgeStats, BriefingReport, AlertItem, ReadingProfile, TopicCluster } from '@/types';

// トップレベルタブ（モバイルナビ過密解消のため分析系はinsightに集約）
type Tab = 'overview' | 'data' | 'readlater' | 'reports' | 'insight' | 'settings';
// インサイト配下のサブタブ
type InsightSub = 'knowledge' | 'research' | 'dna' | 'performance';

const TAB_LABELS: Record<Tab, string> = {
  overview: '全体概要',
  data: '収集データ',
  readlater: '後で読む',
  reports: '調査レポート',
  insight: 'インサイト',
  settings: '設定',
};
const TAB_SHORT: Record<Tab, string> = {
  overview: '概要', data: 'データ', readlater: '後読み', reports: 'レポート', insight: 'インサイト', settings: '設定',
};

const INSIGHT_SUBS: { id: InsightSub; label: string; icon: React.ReactNode }[] = [
  { id: 'knowledge',   label: '知識グラフ',   icon: <Network size={14} /> },
  { id: 'research',    label: '自律リサーチ', icon: <Telescope size={14} /> },
  { id: 'dna',         label: '読書DNA',      icon: <Fingerprint size={14} /> },
  { id: 'performance', label: 'ソース分析',   icon: <BarChart3 size={14} /> },
];
const INSIGHT_LABELS: Record<InsightSub, string> = {
  knowledge: '知識グラフ', research: '自律リサーチ', dna: '読書DNA', performance: 'ソース分析',
};

const SLIDE = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.15 },
};

export default function Home() {
  const { toast } = useToast();
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
  const [conflictingClaims, setConflictingClaims] = useState<ConflictingClaim[]>([]);
  const [leaderboards, setLeaderboards] = useState<BenchmarkLeaderboard[]>([]);
  const [knowledgeRelations, setKnowledgeRelations] = useState<KnowledgeRelation[]>([]);
  const [benchmarkAlerts, setBenchmarkAlerts] = useState<BenchmarkAlert[]>([]);
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStats>({ entities: 0, benchmarks: 0, relations: 0, staleRelations: 0 });
  const [briefing, setBriefing] = useState<BriefingReport | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<AlertItem[]>([]);
  const [readingProfile, setReadingProfile] = useState<ReadingProfile | null>(null);
  const [topicClusters, setTopicClusters] = useState<TopicCluster[]>([]);
  const [recommendations, setRecommendations] = useState<CollectedItem[]>([]);
  const [pipelineLogs, setPipelineLogs] = useState<PipelineLog[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [loadedGroups, setLoadedGroups] = useState<Record<InsightSub, boolean>>({ knowledge: false, research: false, dna: false, performance: false });
  const loadingRef = useRef<Record<string, boolean>>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [interestTags, setInterestTags] = useState<string[]>([]);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  useEffect(() => {
    loadCore();
    try {
      const saved = localStorage.getItem('interestTags');
      // localStorageからの初期化（マウント時のみ・意図的）
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setInterestTags(JSON.parse(saved));
    } catch {}
  }, []);

  // コア（記事・ソース）＋概要タブ分のみ起動時に取得。分析系は開いた時に遅延ロード
  async function loadCore() {
    setIsLoadingData(true);
    const [srcs, data, reportsData, activity, catTrend, modelMentions, trending, conflicts, clusters] = await Promise.all([
      getSourcesData(),
      getCollectedDataList(),
      getReportsData(),
      getActivityData(),
      getCategoryTrendData(),
      getModelMentionData(),
      getTrendingKeywords(),
      getConflictingClaims(),
      getTopicClusters(),
    ]);
    setSourcesList(srcs as Source[]);
    setCollectedItems(data as CollectedItem[]);
    setReportsList(reportsData as Report[]);
    setActivityData(activity);
    setCategoryTrendData(catTrend);
    setModelMentionData(modelMentions);
    setTrendingKeywords(trending);
    setConflictingClaims(conflicts as ConflictingClaim[]);
    setTopicClusters(clusters as TopicCluster[]);
    setIsLoadingData(false);
  }

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
      const [brief, aalerts] = await Promise.all([getBriefing(), getActiveAlerts()]);
      setBriefing(brief as BriefingReport | null);
      setActiveAlerts(aalerts as AlertItem[]);
    } else if (g === 'dna') {
      const [prof, recs] = await Promise.all([getReadingProfile(), getRecommendations()]);
      setReadingProfile(prof as ReadingProfile | null);
      setRecommendations(recs as CollectedItem[]);
    } else if (g === 'performance') {
      const [perf, matrix, logs] = await Promise.all([getSourceROI(), getKeywordCategoryMatrix(), getPipelineLogs()]);
      setSourcePerformance(perf as any[]);
      setKwMatrix(matrix as any);
      setPipelineLogs(logs);
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

  const handleSyncData = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/collect', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        await refresh();
        toast('データ同期が完了しました', 'success');
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
    setCollectedItems(prev => prev.map(item => item.id === id ? { ...item, isFavorited: currentlyFavorited ? 0 : 1 } : item));
    await toggleFavorite(id, currentlyFavorited);
  };

  const handleToggleReadLater = async (id: number, current: boolean) => {
    setCollectedItems(prev => prev.map(item => item.id === id ? { ...item, isReadLater: current ? 0 : 1 } : item));
    await toggleReadLater(id, current);
  };

  const handleMarkAsRead = async (id: number, currentIsRead: boolean) => {
    setCollectedItems(prev => prev.map(item => item.id === id ? { ...item, isRead: currentIsRead ? 0 : 1 } : item));
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

  const readLaterCount = collectedItems.filter(i => i.isReadLater).length;
  const unreadCount = collectedItems.filter(i => !i.isRead).length;
  const currentLabel = activeTab === 'insight' ? INSIGHT_LABELS[insightSub] : TAB_LABELS[activeTab];

  const navItems: [Tab, React.ReactNode, string][] = [
    ['overview', <LayoutGrid key="overview" size={19} />, '全体概要'],
    ['data', <Globe key="data" size={19} />, `収集データ${unreadCount > 0 ? ` (未読${unreadCount})` : ''}`],
    ['readlater', <Bookmark key="readlater" size={19} />, `後で読む${readLaterCount > 0 ? ` (${readLaterCount})` : ''}`],
    ['reports', <FileText key="reports" size={19} />, '調査レポート'],
    ['insight', <Layers key="insight" size={19} />, 'インサイト'],
    ['settings', <Settings key="settings" size={19} />, '設定'],
  ];
  const mobileNavItems: [Tab, React.ReactNode][] = [
    ['overview', <LayoutGrid key="overview" size={22} />],
    ['data', <Globe key="data" size={22} />],
    ['readlater', <Bookmark key="readlater" size={22} />],
    ['reports', <FileText key="reports" size={22} />],
    ['insight', <Layers key="insight" size={22} />],
    ['settings', <Settings key="settings" size={22} />],
  ];

  const insightLoading = !loadedGroups[insightSub];

  const tabContent = (
    <AnimatePresence mode="wait">
      {activeTab === 'overview' && (
        <motion.div key="overview" {...SLIDE}>
          <OverviewTab sourcesList={sourcesList} collectedItems={collectedItems} reportsList={reportsList}
            activityData={activityData} categoryTrendData={categoryTrendData} modelMentionData={modelMentionData}
            trendingKeywords={trendingKeywords} conflictingClaims={conflictingClaims}
            topicClusters={topicClusters} isLoadingData={isLoadingData} />
        </motion.div>
      )}
      {activeTab === 'data' && (
        <motion.div key="data" {...SLIDE}>
          <DataTab collectedItems={collectedItems} isLoadingData={isLoadingData}
            interestTags={interestTags}
            onToggleFavorite={handleToggleFavorite} onToggleReadLater={handleToggleReadLater}
            onMarkAsRead={handleMarkAsRead} />
        </motion.div>
      )}
      {activeTab === 'readlater' && (
        <motion.div key="readlater" {...SLIDE}>
          <ReadLaterTab collectedItems={collectedItems} isLoadingData={isLoadingData}
            interestTags={interestTags} onToggleFavorite={handleToggleFavorite}
            onToggleReadLater={handleToggleReadLater} />
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
              alerts={benchmarkAlerts} stats={knowledgeStats} isLoadingData={insightLoading} />
          )}
          {insightSub === 'research' && (
            <ResearchTab briefing={briefing} alerts={activeAlerts}
              isLoadingData={insightLoading} onReload={refresh} />
          )}
          {insightSub === 'dna' && (
            <ReadingDnaTab profile={readingProfile} recommendations={recommendations} isLoadingData={insightLoading} />
          )}
          {insightSub === 'performance' && (
            <PerformanceTab sourcesList={sourcesList} collectedItems={collectedItems}
              sourcePerformance={sourcePerformance} kwMatrix={kwMatrix}
              pipelineLogs={pipelineLogs} isLoadingData={insightLoading} />
          )}
        </motion.div>
      )}
      {activeTab === 'settings' && (
        <motion.div key="settings" {...SLIDE}>
          <SettingsTab sourcesList={sourcesList} isLoadingData={isLoadingData}
            interestTags={interestTags} onInterestTagsChange={setInterestTags}
            onAddSource={handleAddSource} onDeleteSource={handleDeleteSource}
            onEvolve={handleEvolve} onReload={refresh} />
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
            <span className="font-mono text-[9px] text-sky-500/70 tracking-widest">v3.1</span>
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

        {/* Status */}
        <div className="mt-auto px-2 py-2 rounded-lg border border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <div className="live-dot" />
            <span className="font-mono text-[10px] text-emerald-500 tracking-widest">ONLINE</span>
          </div>
          <p className="font-mono text-[10px] text-slate-700 mt-1 tracking-wide">
            {collectedItems.length} ARTICLES
          </p>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto min-w-0 pb-16 md:pb-0">

        {/* Desktop header */}
        <div className="hidden md:flex flex-col gap-3 px-6 pt-5 pb-4 border-b border-white/5">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold font-outfit">{currentLabel}</h1>
            <button onClick={handleSyncData} disabled={isSyncing}
              className={`btn-primary flex items-center gap-1.5 ${isSyncing ? 'opacity-40 cursor-not-allowed' : ''}`}>
              <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} />
              {isSyncing ? '同期中' : '同期'}
            </button>
          </div>
          {/* Stat chips row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="stat-chip" style={{ color: '#10b981', borderColor: 'rgba(16,185,129,0.2)', background: 'rgba(16,185,129,0.07)' }}>
              <div className="live-dot" style={{ width: 4, height: 4 }} />
              LIVE
            </span>
            <span className="stat-chip" style={{ color: '#38bdf8', borderColor: 'rgba(56,189,248,0.2)', background: 'rgba(56,189,248,0.07)' }}>
              <Zap size={9} />{collectedItems.length} COLLECTED
            </span>
            {unreadCount > 0 && (
              <span className="stat-chip" style={{ color: '#818cf8', borderColor: 'rgba(129,140,248,0.2)', background: 'rgba(129,140,248,0.07)' }}>
                {unreadCount} UNREAD
              </span>
            )}
            {trendingKeywords.length > 0 && (
              <span className="stat-chip" style={{ color: '#f472b6', borderColor: 'rgba(244,114,182,0.2)', background: 'rgba(244,114,182,0.07)' }}>
                {trendingKeywords.length} TRENDING
              </span>
            )}
          </div>
        </div>

        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-white/5 bg-[#03060f]/90 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <div className="live-dot" />
            <span className="font-mono text-[11px] text-slate-400 tracking-wide">{currentLabel}</span>
          </div>
          <button onClick={handleSyncData} disabled={isSyncing}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-40">
            <RefreshCw size={10} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? '同期中...' : '同期'}
          </button>
        </div>

        {/* Tab content */}
        <div className="p-4 md:p-7 md:pt-0">
          {tabContent}
        </div>
      </main>

      {/* ── Desktop Chat Panel ── */}
      <div className="hidden md:flex">
        <ChatPanel />
      </div>

      {/* ── Mobile bottom navigation ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-white/10 flex safe-area-inset-bottom">
        {mobileNavItems.map(([tab, icon]) => {
          const isActive = activeTab === tab;
          const count = tab === 'readlater' && readLaterCount > 0
            ? readLaterCount
            : tab === 'data' && unreadCount > 0
              ? unreadCount
              : null;
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

      {/* ── Mobile floating chat button ── */}
      <button
        onClick={() => setMobileChatOpen(true)}
        className="md:hidden fixed bottom-20 right-4 z-40 w-12 h-12 rounded-full bg-gradient-to-br from-sky-500 to-purple-500 flex items-center justify-center shadow-lg shadow-purple-500/30 active:scale-95 transition-transform"
        aria-label="Geminiチャットを開く"
      >
        <Sparkles size={20} className="text-white" />
      </button>

      {/* ── Mobile chat modal ── */}
      <MobileChatModal isOpen={mobileChatOpen} onClose={() => setMobileChatOpen(false)} />
    </div>
  );
}
