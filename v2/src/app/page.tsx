"use client";

import React, { useState, useEffect } from 'react';
import {
  Activity, LayoutGrid, Globe, Bookmark, FileText, Database,
  BarChart3, Terminal, Sparkles, RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/Toast';
import { ChatPanel } from '@/components/ChatPanel';
import { MobileChatModal } from '@/components/MobileChatModal';
import { OverviewTab } from '@/components/tabs/OverviewTab';
import { DataTab } from '@/components/tabs/DataTab';
import { ReadLaterTab } from '@/components/tabs/ReadLaterTab';
import { ReportsTab } from '@/components/tabs/ReportsTab';
import { SourcesTab } from '@/components/tabs/SourcesTab';
import { PerformanceTab } from '@/components/tabs/PerformanceTab';
import {
  getSourcesData, getCollectedDataList, getReportsData,
  addSource, deleteSource, getActivityData, toggleFavorite, toggleReadLater,
  getSourcePerformance, getCategoryTrendData, getModelMentionData, getKeywordCategoryMatrix,
} from './actions';
import type { CollectedItem, Source, Report, SourcePerformance } from '@/types';

type Tab = 'overview' | 'data' | 'readlater' | 'reports' | 'sources' | 'performance';

const TAB_LABELS: Record<Tab, string> = {
  overview: '全体概要',
  data: '収集データ',
  readlater: '後で読む',
  reports: '調査レポート',
  sources: '情報ソース管理',
  performance: 'ソース分析',
};

const TAB_SHORT: Record<Tab, string> = {
  overview: '概要',
  data: 'データ',
  readlater: '後読み',
  reports: 'レポート',
  sources: 'ソース',
  performance: '分析',
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
  const [sourcePerformance, setSourcePerformance] = useState<SourcePerformance[]>([]);
  const [categoryTrendData, setCategoryTrendData] = useState<any[]>([]);
  const [modelMentionData, setModelMentionData] = useState<{ model: string; count: number }[]>([]);
  const [kwMatrix, setKwMatrix] = useState<{ keywords: string[]; categories: string[]; matrix: any[]; maxCount: number }>({
    keywords: [], categories: [], matrix: [], maxCount: 1,
  });
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
    const [srcs, data, reportsData, activity, performance, catTrend, modelMentions, matrix] = await Promise.all([
      getSourcesData(),
      getCollectedDataList(),
      getReportsData(),
      getActivityData(),
      getSourcePerformance(),
      getCategoryTrendData(),
      getModelMentionData(),
      getKeywordCategoryMatrix(),
    ]);
    setSourcesList(srcs as Source[]);
    setCollectedItems(data as CollectedItem[]);
    setReportsList(reportsData as Report[]);
    setActivityData(activity);
    setSourcePerformance(performance as SourcePerformance[]);
    setCategoryTrendData(catTrend);
    setModelMentionData(modelMentions);
    setKwMatrix(matrix as any);
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

  const navItems: [Tab, React.ReactNode, string][] = [
    ['overview', <LayoutGrid size={19} />, '全体概要'],
    ['data', <Globe size={19} />, '収集データ'],
    ['readlater', <Bookmark size={19} />, `後で読む${readLaterCount > 0 ? ` (${readLaterCount})` : ''}`],
    ['reports', <FileText size={19} />, '調査レポート'],
    ['sources', <Database size={19} />, '情報ソース管理'],
    ['performance', <BarChart3 size={19} />, 'ソース分析'],
  ];

  const mobileNavItems: [Tab, React.ReactNode][] = [
    ['overview', <LayoutGrid size={22} />],
    ['data', <Globe size={22} />],
    ['readlater', <Bookmark size={22} />],
    ['reports', <FileText size={22} />],
    ['sources', <Database size={22} />],
    ['performance', <BarChart3 size={22} />],
  ];

  const tabContent = (
    <AnimatePresence mode="wait">
      {activeTab === 'overview' && (
        <motion.div key="overview" {...SLIDE}>
          <OverviewTab sourcesList={sourcesList} collectedItems={collectedItems} reportsList={reportsList}
            activityData={activityData} categoryTrendData={categoryTrendData} modelMentionData={modelMentionData}
            isLoadingData={isLoadingData} />
        </motion.div>
      )}
      {activeTab === 'data' && (
        <motion.div key="data" {...SLIDE}>
          <DataTab collectedItems={collectedItems} isLoadingData={isLoadingData}
            interestTags={interestTags} onInterestTagsChange={setInterestTags}
            onToggleFavorite={handleToggleFavorite} onToggleReadLater={handleToggleReadLater} />
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
      {activeTab === 'sources' && (
        <motion.div key="sources" {...SLIDE}>
          <SourcesTab sourcesList={sourcesList} isLoadingData={isLoadingData}
            onAddSource={handleAddSource} onDeleteSource={handleDeleteSource} onEvolve={handleEvolve} />
        </motion.div>
      )}
      {activeTab === 'performance' && (
        <motion.div key="performance" {...SLIDE}>
          <PerformanceTab sourcesList={sourcesList} collectedItems={collectedItems}
            sourcePerformance={sourcePerformance} kwMatrix={kwMatrix} isLoadingData={isLoadingData} />
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-56 border-r border-white/5 p-5 flex-col gap-6 flex-shrink-0">
        <div className="flex items-center gap-3 px-1">
          <div className="w-9 h-9 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/20 flex-shrink-0">
            <Terminal className="text-white" size={19} />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-base font-outfit leading-tight truncate">AI Researcher</h2>
            <span className="text-[10px] text-sky-400 font-medium tracking-widest uppercase">V2 Serverless</span>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {navItems.map(([tab, icon, label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`sidebar-item text-sm ${activeTab === tab ? 'active' : ''}`}>
              {icon}
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>

        <div className="mt-auto p-3 rounded-2xl bg-white/5 border border-white/5">
          <p className="text-xs text-slate-500 mb-1.5">システムステータス</p>
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
            オンライン・稼働中
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto min-w-0 pb-16 md:pb-0">

        {/* Desktop header */}
        <div className="hidden md:flex justify-between items-center p-7 pb-6">
          <div>
            <h1 className="text-2xl font-bold font-outfit mb-0.5">{TAB_LABELS[activeTab]}</h1>
            <p className="text-slate-500 text-sm">自ら学習し、進化する次世代の情報収集基盤</p>
          </div>
          <button onClick={handleSyncData} disabled={isSyncing}
            className={`btn-primary flex items-center gap-2 ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <Activity size={16} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? '同期中...' : 'データ同期'}
          </button>
        </div>

        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between px-4 pt-4 pb-3 border-b border-white/5 bg-slate-950/80 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-sky-500 flex items-center justify-center shadow-md flex-shrink-0">
              <Terminal className="text-white" size={14} />
            </div>
            <h1 className="font-bold text-sm font-outfit">{TAB_LABELS[activeTab]}</h1>
          </div>
          <button onClick={handleSyncData} disabled={isSyncing}
            className="flex items-center gap-1.5 bg-white/5 border border-white/10 text-slate-300 px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-50">
            <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? '同期中' : '同期'}
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
          const count = tab === 'readlater' && readLaterCount > 0 ? readLaterCount : null;
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
