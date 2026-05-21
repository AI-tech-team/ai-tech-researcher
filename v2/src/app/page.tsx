"use client";

import React, { useState, useEffect } from 'react';
import {
  LayoutGrid, Globe, Bookmark, FileText, Settings,
  BarChart3, Terminal, Sparkles, RefreshCw, Zap, Network, Telescope,
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
import {
  getSourcesData, getCollectedDataList, getReportsData,
  addSource, deleteSource, getActivityData, toggleFavorite, toggleReadLater, markAsRead,
  getSourcePerformance, getSourceROI, getCategoryTrendData, getModelMentionData,
  getKeywordCategoryMatrix, getTrendingKeywords, getPipelineLogs, getConflictingClaims,
  getBenchmarkLeaderboards, getKnowledgeRelations, getBenchmarkAlerts, getKnowledgeStats,
  getBriefing, getActiveAlerts,
} from './actions';
import type { CollectedItem, Source, Report, SourcePerformance, PipelineLog, TrendingKeyword, ConflictingClaim, BenchmarkLeaderboard, KnowledgeRelation, BenchmarkAlert, KnowledgeStats, BriefingReport, AlertItem } from '@/types';

type Tab = 'overview' | 'data' | 'readlater' | 'reports' | 'performance' | 'knowledge' | 'research' | 'settings';

const TAB_LABELS: Record<Tab, string> = {
  overview: '全体概要',
  data: '収集データ',
  readlater: '後で読む',
  reports: '調査レポート',
  performance: 'ソース分析',
  knowledge: '知識グラフ',
  research: '自律リサーチ',
  settings: '設定',
};

const TAB_SHORT: Record<Tab, string> = {
  overview: '概要',
  data: 'データ',
  readlater: '後読み',
  reports: 'レポート',
  performance: '分析',
  knowledge: '知識',
  research: 'リサーチ',
  settings: '設定',
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
  const [pipelineLogs, setPipelineLogs] = useState<PipelineLog[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [interestTags, setInterestTags] = useState<string[]>([]);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  useEffect(() => {
    loadData();
    try {
      const saved = localStorage.getItem('interestTags');
      if (saved) setInterestTags(JSON.parse(saved));
    } catch {}
  }, []);

  async function loadData() {
    setIsLoadingData(true);
    const [srcs, data, reportsData, activity, performance, catTrend, modelMentions, matrix, trending, logs, conflicts, lbs, krels, balerts, kstats, brief, aalerts] = await Promise.all([
      getSourcesData(),
      getCollectedDataList(),
      getReportsData(),
      getActivityData(),
      getSourceROI(),
      getCategoryTrendData(),
      getModelMentionData(),
      getKeywordCategoryMatrix(),
      getTrendingKeywords(),
      getPipelineLogs(),
      getConflictingClaims(),
      getBenchmarkLeaderboards(),
      getKnowledgeRelations(),
      getBenchmarkAlerts(),
      getKnowledgeStats(),
      getBriefing(),
      getActiveAlerts(),
    ]);
    setSourcesList(srcs as Source[]);
    setCollectedItems(data as CollectedItem[]);
    setReportsList(reportsData as Report[]);
    setActivityData(activity);
    setSourcePerformance(performance as any[]);
    setCategoryTrendData(catTrend);
    setModelMentionData(modelMentions);
    setKwMatrix(matrix as any);
    setTrendingKeywords(trending);
    setPipelineLogs(logs);
    setConflictingClaims(conflicts as ConflictingClaim[]);
    setLeaderboards(lbs as BenchmarkLeaderboard[]);
    setKnowledgeRelations(krels as KnowledgeRelation[]);
    setBenchmarkAlerts(balerts as BenchmarkAlert[]);
    setKnowledgeStats(kstats as KnowledgeStats);
    setBriefing(brief as BriefingReport | null);
    setActiveAlerts(aalerts as AlertItem[]);
    setIsLoadingData(false);
  }

  const handleSyncData = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/collect', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        await loadData();
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
    await loadData();
  };

  const handleDeleteSource = async (id: number) => {
    await deleteSource(id);
    await loadData();
  };

  const handleEvolve = async () => {
    const res = await fetch('/api/evolve', { method: 'POST' });
    const result = await res.json();
    if (!result.success) throw new Error(result.message ?? '不明なエラー');
    await loadData();
  };

  const readLaterCount = collectedItems.filter(i => i.isReadLater).length;
  const unreadCount = collectedItems.filter(i => !i.isRead).length;

  const navItems: [Tab, React.ReactNode, string][] = [
    ['overview', <LayoutGrid size={19} />, '全体概要'],
    ['data', <Globe size={19} />, `収集データ${unreadCount > 0 ? ` (未読${unreadCount})` : ''}`],
    ['readlater', <Bookmark size={19} />, `後で読む${readLaterCount > 0 ? ` (${readLaterCount})` : ''}`],
    ['reports', <FileText size={19} />, '調査レポート'],
    ['performance', <BarChart3 size={19} />, 'ソース分析'],
    ['knowledge', <Network size={19} />, '知識グラフ'],
    ['research', <Telescope size={19} />, '自律リサーチ'],
    ['settings', <Settings size={19} />, '設定'],
  ];

  const mobileNavItems: [Tab, React.ReactNode][] = [
    ['overview', <LayoutGrid size={22} />],
    ['data', <Globe size={22} />],
    ['readlater', <Bookmark size={22} />],
    ['reports', <FileText size={22} />],
    ['performance', <BarChart3 size={22} />],
    ['knowledge', <Network size={22} />],
    ['research', <Telescope size={22} />],
    ['settings', <Settings size={22} />],
  ];

  const tabContent = (
    <AnimatePresence mode="wait">
      {activeTab === 'overview' && (
        <motion.div key="overview" {...SLIDE}>
          <OverviewTab sourcesList={sourcesList} collectedItems={collectedItems} reportsList={reportsList}
            activityData={activityData} categoryTrendData={categoryTrendData} modelMentionData={modelMentionData}
            trendingKeywords={trendingKeywords} conflictingClaims={conflictingClaims} isLoadingData={isLoadingData} />
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
            collectedItemsCount={collectedItems.length} onReload={loadData} />
        </motion.div>
      )}
      {activeTab === 'performance' && (
        <motion.div key="performance" {...SLIDE}>
          <PerformanceTab sourcesList={sourcesList} collectedItems={collectedItems}
            sourcePerformance={sourcePerformance} kwMatrix={kwMatrix}
            pipelineLogs={pipelineLogs} isLoadingData={isLoadingData} />
        </motion.div>
      )}
      {activeTab === 'knowledge' && (
        <motion.div key="knowledge" {...SLIDE}>
          <KnowledgeTab leaderboards={leaderboards} relations={knowledgeRelations}
            alerts={benchmarkAlerts} stats={knowledgeStats} isLoadingData={isLoadingData} />
        </motion.div>
      )}
      {activeTab === 'research' && (
        <motion.div key="research" {...SLIDE}>
          <ResearchTab briefing={briefing} alerts={activeAlerts}
            isLoadingData={isLoadingData} onReload={loadData} />
        </motion.div>
      )}
      {activeTab === 'settings' && (
        <motion.div key="settings" {...SLIDE}>
          <SettingsTab sourcesList={sourcesList} isLoadingData={isLoadingData}
            interestTags={interestTags} onInterestTagsChange={setInterestTags}
            onAddSource={handleAddSource} onDeleteSource={handleDeleteSource}
            onEvolve={handleEvolve} onReload={loadData} />
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
            <Terminal className="text-white" size={14} />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-sm font-outfit leading-tight truncate">AI Researcher</h2>
            <span className="font-mono text-[9px] text-sky-500/70 tracking-widest">v2.0</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5">
          {navItems.map(([tab, icon, label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
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
            <h1 className="text-lg font-bold font-outfit">{TAB_LABELS[activeTab]}</h1>
            <button onClick={handleSyncData} disabled={isSyncing}
              className={`btn-primary flex items-center gap-1.5 ${isSyncing ? 'opacity-40 cursor-not-allowed' : ''}`}>
              <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} />
              {isSyncing ? 'SYNCING' : 'SYNC'}
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
            <span className="font-mono text-[11px] text-slate-400 tracking-wide">{TAB_LABELS[activeTab]}</span>
          </div>
          <button onClick={handleSyncData} disabled={isSyncing}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-40">
            <RefreshCw size={10} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'SYNC...' : 'SYNC'}
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
              onClick={() => setActiveTab(tab)}
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
