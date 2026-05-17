"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  Search, FileText, TrendingUp, Activity, Globe, LayoutGrid, Database,
  Terminal, BarChart3, Send, User, ExternalLink, Hash, Clock, Sparkles,
  Plus, Trash2, RefreshCw, Star, Zap, Bookmark, Brain, Award,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar as RechartsBar,
} from 'recharts';
import {
  getSourcesData, getCollectedDataList, getReportsData,
  addSource, deleteSource, getActivityData, toggleFavorite, getSourcePerformance,
  getCategoryTrendData, getModelMentionData, semanticSearch, toggleReadLater, getKeywordCategoryMatrix,
} from './actions';

type Tab = 'overview' | 'data' | 'readlater' | 'reports' | 'sources' | 'performance';

const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': '#38bdf8',
  'エージェント': '#818cf8',
  'ツール/フレームワーク': '#34d399',
  'ハードウェア': '#fb923c',
  'ビジネス応用': '#f472b6',
  '研究/論文': '#a78bfa',
  'その他': '#94a3b8',
};
const CATEGORY_LIST = Object.keys(CATEGORY_COLORS);

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [sourcesList, setSourcesList] = useState<any[]>([]);
  const [collectedItems, setCollectedItems] = useState<any[]>([]);
  const [reportsList, setReportsList] = useState<any[]>([]);
  const [activityData, setActivityData] = useState<{ name: string; count: number }[]>([]);
  const [sourcePerformance, setSourcePerformance] = useState<any[]>([]);
  const [categoryTrendData, setCategoryTrendData] = useState<any[]>([]);
  const [modelMentionData, setModelMentionData] = useState<{ model: string; count: number }[]>([]);
  const [kwMatrix, setKwMatrix] = useState<{ keywords: string[]; categories: string[]; matrix: any[]; maxCount: number }>({ keywords: [], categories: [], matrix: [], maxCount: 1 });
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [isEvolving, setIsEvolving] = useState(false);
  const [reportTypeFilter, setReportTypeFilter] = useState<'all' | 'daily' | 'weekly' | 'monthly'>('all');
  const [isGeneratingWeekly, setIsGeneratingWeekly] = useState(false);
  const [isGeneratingMonthly, setIsGeneratingMonthly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [interestTags, setInterestTags] = useState<string[]>([]);
  const [newInterestTag, setNewInterestTag] = useState('');
  const [isSemanticSearching, setIsSemanticSearching] = useState(false);
  const [semanticResults, setSemanticResults] = useState<any[] | null>(null);
  const [sortByImportance, setSortByImportance] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const isLoading = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    loadData();
    try {
      const saved = localStorage.getItem('interestTags');
      if (saved) setInterestTags(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => { setSemanticResults(null); }, [searchQuery]);

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
    setSourcesList(srcs);
    setCollectedItems(data);
    setReportsList(reportsData);
    setActivityData(activity);
    setSourcePerformance(performance);
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
      if (result.success) { await loadData(); } else { alert("同期エラー: " + result.message); }
    } catch { alert("通信エラーが発生しました"); }
    finally { setIsSyncing(false); }
  };

  const handleGenerateReport = async () => {
    if (isGeneratingReport) return;
    setIsGeneratingReport(true);
    try {
      const res = await fetch('/api/report', { method: 'POST' });
      const result = await res.json();
      if (result.success) { await loadData(); setActiveTab('reports'); } else { alert("レポート生成エラー: " + result.message); }
    } catch { alert("通信エラーが発生しました"); }
    finally { setIsGeneratingReport(false); }
  };

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    await addSource(newKeyword);
    setNewKeyword('');
    await loadData();
  };

  const handleDeleteSource = async (id: number) => {
    await deleteSource(id);
    await loadData();
  };

  const handleGenerateWeekly = async () => {
    if (isGeneratingWeekly) return;
    setIsGeneratingWeekly(true);
    try {
      const res = await fetch('/api/report/weekly', { method: 'POST' });
      const result = await res.json();
      if (result.success) { await loadData(); setReportTypeFilter('weekly'); } else { alert("週次レポートエラー: " + result.message); }
    } catch { alert("通信エラーが発生しました"); }
    finally { setIsGeneratingWeekly(false); }
  };

  const handleGenerateMonthly = async () => {
    if (isGeneratingMonthly) return;
    setIsGeneratingMonthly(true);
    try {
      const res = await fetch('/api/report/monthly', { method: 'POST' });
      const result = await res.json();
      if (result.success) { await loadData(); setReportTypeFilter('monthly'); } else { alert("月次レポートエラー: " + result.message); }
    } catch { alert("通信エラーが発生しました"); }
    finally { setIsGeneratingMonthly(false); }
  };

  const handleEvolve = async () => {
    if (isEvolving) return;
    setIsEvolving(true);
    try {
      const res = await fetch('/api/evolve', { method: 'POST' });
      const result = await res.json();
      if (result.success) { await loadData(); alert(result.message); } else { alert("進化エラー: " + result.message); }
    } catch { alert("通信エラーが発生しました"); }
    finally { setIsEvolving(false); }
  };

  const handleToggleFavorite = async (id: number, currentlyFavorited: boolean) => {
    setCollectedItems(prev => prev.map(item => item.id === id ? { ...item, isFavorited: currentlyFavorited ? 0 : 1 } : item));
    await toggleFavorite(id, currentlyFavorited);
  };

  const handleToggleReadLater = async (id: number, current: boolean) => {
    const newVal = current ? 0 : 1;
    setCollectedItems(prev => prev.map(item => item.id === id ? { ...item, isReadLater: newVal } : item));
    if (semanticResults) setSemanticResults(prev => prev ? prev.map(item => item.id === id ? { ...item, isReadLater: newVal } : item) : null);
    await toggleReadLater(id, current);
  };

  const handleSemanticSearch = async () => {
    if (!searchQuery.trim() || isSemanticSearching) return;
    setIsSemanticSearching(true);
    try {
      const results = await semanticSearch(searchQuery);
      setSemanticResults(results as any[]);
    } catch { alert('AI検索に失敗しました'); }
    finally { setIsSemanticSearching(false); }
  };

  const addInterestTag = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newInterestTag.trim()) return;
    const updated = [...interestTags, newInterestTag.trim()];
    setInterestTags(updated);
    localStorage.setItem('interestTags', JSON.stringify(updated));
    setNewInterestTag('');
  };

  const removeInterestTag = (tag: string) => {
    const updated = interestTags.filter(t => t !== tag);
    setInterestTags(updated);
    localStorage.setItem('interestTags', JSON.stringify(updated));
  };

  // 派生データ
  const categories = ['all', ...Array.from(new Set(collectedItems.map(i => i.category).filter(Boolean))) as string[]];
  const baseItems = semanticResults ?? collectedItems;
  const filteredItems = baseItems.filter(item => {
    const matchSearch = !searchQuery || semanticResults != null ||
      item.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.summary?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCategory = categoryFilter === 'all' || item.category === categoryFilter;
    return matchSearch && matchCategory;
  });
  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sortByImportance) return (b.importanceScore ?? 5) - (a.importanceScore ?? 5);
    if (interestTags.length > 0) {
      const aMatch = interestTags.some(tag => [a.title, a.summary, a.category].some(f => f?.toLowerCase().includes(tag.toLowerCase())));
      const bMatch = interestTags.some(tag => [b.title, b.summary, b.category].some(f => f?.toLowerCase().includes(tag.toLowerCase())));
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
    }
    return 0;
  });
  const readLaterItems = collectedItems.filter(i => i.isReadLater);

  const chartData = [
    { name: '稼働中', value: sourcesList.filter(s => s.status === 'active').length },
    { name: '候補', value: sourcesList.filter(s => s.status === 'candidate').length },
    { name: '低優先度', value: sourcesList.filter(s => s.status === 'low-priority').length },
  ];

  const scoreToPercent = (score: number) => Math.min(100, Math.max(0, (score + 20) * 2.5));

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'candidate': return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
      case 'low-priority': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  const tabLabel: Record<Tab, string> = {
    overview: '全体概要',
    data: '収集データ',
    readlater: '後で読む',
    reports: '調査レポート',
    sources: '情報ソース管理',
    performance: 'ソース分析',
  };

  const ArticleCard = ({ item, showReadLater = true }: { item: any; showReadLater?: boolean }) => {
    const isInterestMatch = interestTags.length > 0 && interestTags.some(tag =>
      [item.title, item.summary, item.category].some(f => f?.toLowerCase().includes(tag.toLowerCase()))
    );
    return (
      <div className="glass-card group hover:border-sky-500/30">
        <div className="flex justify-between items-start mb-2">
          <h4 className="text-lg font-bold text-white group-hover:text-sky-400 transition-colors flex-1 pr-4">{item.title || '無題のデータ'}</h4>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isInterestMatch && <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full">おすすめ</span>}
            {item.importanceScore >= 8 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-bold flex items-center gap-1 ${item.importanceScore >= 9 ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-orange-500/10 text-orange-400 border-orange-500/20'}`}>
                <Award size={10} />{item.importanceScore}
              </span>
            )}
            <button onClick={() => handleToggleFavorite(item.id, !!item.isFavorited)} title={item.isFavorited ? 'お気に入り解除' : 'お気に入り'}>
              <Star size={16} className={item.isFavorited ? 'fill-amber-400 text-amber-400' : 'text-slate-600 hover:text-amber-400'} />
            </button>
            {showReadLater && (
              <button onClick={() => handleToggleReadLater(item.id, !!item.isReadLater)} title={item.isReadLater ? '後で読むを解除' : '後で読む'}>
                <Bookmark size={16} className={item.isReadLater ? 'fill-sky-400 text-sky-400' : 'text-slate-600 hover:text-sky-400'} />
              </button>
            )}
            {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white"><ExternalLink size={16} /></a>}
          </div>
        </div>
        <p className="text-slate-400 text-sm line-clamp-2 mb-4">{item.summary || 'サマリーはありません'}</p>
        <div className="flex items-center gap-3 flex-wrap text-xs font-medium">
          {item.category && (
            <span className="px-2 py-1 rounded-md border" style={{ backgroundColor: `${CATEGORY_COLORS[item.category] ?? '#94a3b8'}15`, color: CATEGORY_COLORS[item.category] ?? '#94a3b8', borderColor: `${CATEGORY_COLORS[item.category] ?? '#94a3b8'}30` }}>
              {item.category}
            </span>
          )}
          <span className="flex items-center gap-1 text-sky-400 bg-sky-500/10 px-2 py-1 rounded-md">
            <Hash size={12} /> {item.sourceValue || '不明'}
          </span>
          <span className="flex items-center gap-1 text-slate-500">
            <Clock size={12} /> {new Date(item.createdAt).toLocaleString('ja-JP')}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 p-6 flex flex-col gap-8 flex-shrink-0">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Terminal className="text-white" size={24} />
          </div>
          <div>
            <h2 className="font-bold text-lg font-outfit leading-tight">AI Researcher</h2>
            <span className="text-[10px] text-sky-400 font-medium tracking-widest uppercase">V2 Serverless</span>
          </div>
        </div>

        <nav className="flex flex-col gap-2">
          {([
            ['overview', <LayoutGrid size={20} />, '全体概要'],
            ['data', <Globe size={20} />, '収集データ'],
            ['readlater', <Bookmark size={20} />, `後で読む${readLaterItems.length > 0 ? ` (${readLaterItems.length})` : ''}`],
            ['reports', <FileText size={20} />, '調査レポート'],
            ['sources', <Database size={20} />, '情報ソース管理'],
            ['performance', <BarChart3 size={20} />, 'ソース分析'],
          ] as [Tab, React.ReactNode, string][]).map(([tab, icon, label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`sidebar-item ${activeTab === tab ? 'active' : ''}`}>
              {icon} {label}
            </button>
          ))}
        </nav>

        <div className="mt-auto p-4 rounded-2xl bg-white/5 border border-white/5">
          <p className="text-xs text-slate-500 mb-2">システムステータス</p>
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            オンライン・稼働中
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <header className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-3xl font-bold font-outfit mb-1">{tabLabel[activeTab]}</h1>
            <p className="text-slate-500 text-sm">自ら学習し、進化する次世代の情報収集基盤</p>
          </div>
          <button onClick={handleSyncData} disabled={isSyncing} className={`btn-primary flex items-center gap-2 ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <Activity size={18} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? '同期中...' : 'データ同期'}
          </button>
        </header>

        <AnimatePresence mode="wait">

          {/* ── 全体概要 ── */}
          {activeTab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-8">
              <div className="grid grid-cols-4 gap-6">
                {[
                  { label: '有効な情報源', value: sourcesList.filter(s => s.status === 'active').length, color: 'text-sky-400', icon: <TrendingUp size={20} /> },
                  { label: '収集データ件数', value: collectedItems.length, color: 'text-purple-400', icon: <Globe size={20} /> },
                  { label: '生成レポート数', value: reportsList.length, color: 'text-emerald-400', icon: <FileText size={20} /> },
                  { label: 'お気に入り数', value: collectedItems.filter(i => i.isFavorited).length, color: 'text-amber-400', icon: <Star size={20} /> },
                ].map((stat, idx) => (
                  <div key={idx} className="glass-card">
                    <div className="flex justify-between items-start mb-4">
                      <div className={`p-2 rounded-lg bg-white/5 ${stat.color}`}>{stat.icon}</div>
                    </div>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{stat.label}</p>
                    <h3 className="text-3xl font-bold font-outfit">{isLoadingData ? '-' : stat.value}</h3>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-8">
                <div className="col-span-2 glass-card h-[340px]">
                  <h3 className="text-lg font-bold font-outfit mb-6 flex items-center gap-2">
                    <BarChart3 size={20} className="text-sky-400" /> 収集アクティビティ（直近7日）
                  </h3>
                  <ResponsiveContainer width="100%" height="85%">
                    <AreaChart data={activityData}>
                      <defs>
                        <linearGradient id="colorCount" x1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="name" stroke="#475569" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#475569" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} itemStyle={{ color: '#38bdf8' }} />
                      <Area type="monotone" dataKey="count" name="収集件数" stroke="#38bdf8" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="glass-card h-[340px]">
                  <h3 className="text-lg font-bold font-outfit mb-6 flex items-center gap-2">
                    <Database size={20} className="text-purple-400" /> ソース健全性
                  </h3>
                  <ResponsiveContainer width="100%" height="85%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="name" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                      <RechartsBar dataKey="value" name="件数" fill="#818cf8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-8">
                <div className="col-span-2 glass-card h-[340px]">
                  <h3 className="text-lg font-bold font-outfit mb-6 flex items-center gap-2">
                    <TrendingUp size={20} className="text-emerald-400" /> カテゴリ別トレンド（直近7日）
                  </h3>
                  <ResponsiveContainer width="100%" height="85%">
                    <AreaChart data={categoryTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="name" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#475569" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                      {CATEGORY_LIST.map(cat => (
                        <Area key={cat} type="monotone" dataKey={cat} stackId="1" stroke={CATEGORY_COLORS[cat]} fill={CATEGORY_COLORS[cat]} fillOpacity={0.6} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="glass-card h-[340px]">
                  <h3 className="text-lg font-bold font-outfit mb-4 flex items-center gap-2">
                    <Brain size={20} className="text-pink-400" /> モデル言及頻度（30日）
                  </h3>
                  {modelMentionData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="85%">
                      <BarChart data={modelMentionData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                        <XAxis type="number" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="model" stroke="#475569" fontSize={11} tickLine={false} axisLine={false} width={65} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                        <RechartsBar dataKey="count" name="言及数" fill="#f472b6" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[80%] text-slate-500 text-sm">データなし（30日分蓄積後に表示）</div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── 収集データ ── */}
          {activeTab === 'data' && (
            <motion.div key="data" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {/* 検索 + AI検索 */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSemanticSearch()}
                    placeholder="タイトル・サマリーを検索..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-9 pr-4 text-sm text-white focus:outline-none focus:border-sky-500/50"
                  />
                </div>
                <button
                  onClick={handleSemanticSearch}
                  disabled={isSemanticSearching || !searchQuery.trim()}
                  className="flex items-center gap-2 bg-purple-500/20 border border-purple-500/30 text-purple-300 px-4 py-2 rounded-xl text-sm font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50"
                  title="Geminiがクエリを意味解析して検索"
                >
                  <Brain size={16} className={isSemanticSearching ? 'animate-pulse' : ''} />
                  AI検索
                </button>
              </div>

              {/* 興味タグ */}
              <div className="flex items-center gap-2 flex-wrap p-3 rounded-xl bg-white/3 border border-white/5">
                <span className="text-xs text-slate-500 font-medium flex-shrink-0">興味タグ:</span>
                {interestTags.map(tag => (
                  <span key={tag} className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs flex items-center gap-1">
                    {tag}
                    <button onClick={() => removeInterestTag(tag)} className="hover:text-red-400 ml-0.5 leading-none">×</button>
                  </span>
                ))}
                <form onSubmit={addInterestTag} className="flex gap-1">
                  <input
                    value={newInterestTag}
                    onChange={e => setNewInterestTag(e.target.value)}
                    placeholder="+ タグ追加"
                    className="bg-transparent border-b border-white/20 text-xs text-slate-400 focus:outline-none focus:border-amber-500/50 w-24 px-1 py-0.5"
                  />
                </form>
                {interestTags.length > 0 && <span className="text-[10px] text-amber-400/60 ml-1">マッチした記事を優先表示</span>}
              </div>

              {/* カテゴリフィルター + ソート */}
              <div className="flex flex-wrap items-center gap-2">
                {categories.map(cat => (
                  <button key={cat} onClick={() => setCategoryFilter(cat)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${categoryFilter === cat ? 'bg-sky-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>
                    {cat === 'all' ? '全て' : cat}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => setSortByImportance(!sortByImportance)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${sortByImportance ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>
                    <Award size={12} /> 重要度順
                  </button>
                  {semanticResults != null && (
                    <button onClick={() => setSemanticResults(null)} className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1">
                      AI検索: {semanticResults.length}件 ×
                    </button>
                  )}
                  <p className="text-xs text-slate-500">{sortedItems.length}件</p>
                </div>
              </div>

              {isLoadingData ? (
                <div className="flex justify-center items-center py-20 text-sky-400">
                  <Activity className="animate-pulse" size={32} />
                </div>
              ) : sortedItems.length > 0 ? (
                <div className="grid grid-cols-1 gap-4">
                  {sortedItems.map(item => <ArticleCard key={item.id} item={item} />)}
                </div>
              ) : (
                <div className="glass-card text-center py-20 text-slate-400">
                  <Database size={48} className="mx-auto mb-4 opacity-20" />
                  <p>データが見つかりません。</p>
                </div>
              )}
            </motion.div>
          )}

          {/* ── 後で読む ── */}
          {activeTab === 'readlater' && (
            <motion.div key="readlater" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {isLoadingData ? (
                <div className="flex justify-center items-center py-20 text-sky-400"><Activity className="animate-pulse" size={32} /></div>
              ) : readLaterItems.length > 0 ? (
                <>
                  <p className="text-xs text-slate-500">{readLaterItems.length}件のブックマーク</p>
                  <div className="grid grid-cols-1 gap-4">
                    {readLaterItems.map(item => <ArticleCard key={item.id} item={item} showReadLater={true} />)}
                  </div>
                </>
              ) : (
                <div className="glass-card text-center py-20 text-slate-400">
                  <Bookmark size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="mb-2">ブックマークした記事がありません。</p>
                  <p className="text-xs text-slate-500">収集データタブの記事カードにある <Bookmark size={12} className="inline" /> ボタンで登録できます。</p>
                </div>
              )}
            </motion.div>
          )}

          {/* ── 調査レポート ── */}
          {activeTab === 'reports' && (
            <motion.div key="reports" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                <div className="flex gap-2">
                  {(['all', 'daily', 'weekly', 'monthly'] as const).map(t => (
                    <button key={t} onClick={() => setReportTypeFilter(t)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${reportTypeFilter === t ? 'bg-sky-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>
                      {t === 'all' ? '全て' : t === 'daily' ? '日次' : t === 'weekly' ? '週次' : '月次'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {[
                    { label: '日次', loading: isGeneratingReport, handler: handleGenerateReport, color: 'from-emerald-500 to-teal-500 shadow-emerald-500/20' },
                    { label: '週次', loading: isGeneratingWeekly, handler: handleGenerateWeekly, color: 'from-sky-500 to-blue-500 shadow-sky-500/20' },
                    { label: '月次', loading: isGeneratingMonthly, handler: handleGenerateMonthly, color: 'from-purple-500 to-violet-500 shadow-purple-500/20' },
                  ].map(btn => (
                    <button key={btn.label} onClick={btn.handler} disabled={btn.loading || collectedItems.length === 0}
                      className={`bg-gradient-to-r ${btn.color} text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm shadow-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed`}>
                      <Sparkles size={16} className={btn.loading ? 'animate-spin' : ''} />
                      {btn.loading ? '生成中...' : btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {isLoadingData ? (
                <div className="flex justify-center items-center py-20 text-emerald-400"><Activity className="animate-pulse" size={32} /></div>
              ) : reportsList.filter(r => reportTypeFilter === 'all' || r.type === reportTypeFilter).length > 0 ? (
                <div className="space-y-8">
                  {reportsList.filter(r => reportTypeFilter === 'all' || r.type === reportTypeFilter).map(report => (
                    <div key={report.id} className="glass-card border-emerald-500/20 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-4 opacity-10"><FileText size={100} /></div>
                      <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4 relative z-10">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                          <span className="text-emerald-400">■</span>
                          {report.type === 'weekly' ? '週次サマリーレポート' : report.type === 'monthly' ? '月次サマリーレポート' : 'デイリーレポート'}
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${report.type === 'weekly' ? 'bg-sky-500/20 text-sky-400' : report.type === 'monthly' ? 'bg-purple-500/20 text-purple-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                            {report.type}
                          </span>
                        </h3>
                        <span className="text-sm text-slate-400 bg-white/5 px-3 py-1 rounded-full">{report.reportDate}</span>
                      </div>
                      <div className="prose prose-invert max-w-none relative z-10 whitespace-pre-wrap text-slate-300 leading-relaxed text-sm">
                        {report.content.split('\n').map((line: string, i: number) => {
                          if (line.startsWith('###')) return <h4 key={i} className="text-lg font-bold text-white mt-6 mb-2">{line.replace('###', '').trim()}</h4>;
                          if (line.startsWith('##')) return <h3 key={i} className="text-xl font-bold text-sky-400 mt-8 mb-4">{line.replace('##', '').trim()}</h3>;
                          if (line.startsWith('#')) return <h2 key={i} className="text-2xl font-bold text-emerald-400 mt-8 mb-4">{line.replace('#', '').trim()}</h2>;
                          if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="ml-4 mb-1">{line.substring(2)}</li>;
                          return <p key={i} className="mb-2">{line}</p>;
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-400 text-center py-20 glass-card border-dashed">
                  <FileText size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="mb-2">レポートはまだ生成されていません。</p>
                  <p className="text-xs text-slate-500">上のボタンをクリックしてレポートを生成してください。</p>
                </div>
              )}
            </motion.div>
          )}

          {/* ── 情報ソース管理 ── */}
          {activeTab === 'sources' && (
            <motion.div key="sources" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <div className="flex gap-3">
                <form onSubmit={handleAddKeyword} className="flex gap-2 flex-1">
                  <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)} placeholder="新規キーワードを追加..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-sm text-white focus:outline-none focus:border-sky-500/50" />
                  <button type="submit" className="btn-primary flex items-center gap-2 px-4 py-2"><Plus size={16} /> 追加</button>
                </form>
                <button onClick={handleEvolve} disabled={isEvolving}
                  className="flex items-center gap-2 bg-purple-500/20 border border-purple-500/30 text-purple-300 px-4 py-2 rounded-xl text-sm font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50">
                  <RefreshCw size={16} className={isEvolving ? 'animate-spin' : ''} />
                  {isEvolving ? '進化中...' : 'ソース自動進化'}
                </button>
              </div>

              <div className="glass-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-slate-400 uppercase bg-white/5 border-b border-white/5">
                      <tr>
                        <th className="px-6 py-4">種別</th>
                        <th className="px-6 py-4">値</th>
                        <th className="px-6 py-4">ステータス</th>
                        <th className="px-6 py-4">スコア</th>
                        <th className="px-6 py-4"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoadingData ? (
                        <tr><td colSpan={5} className="text-center py-8 text-sky-400"><Activity className="animate-pulse mx-auto" /></td></tr>
                      ) : sourcesList.map(source => (
                        <tr key={source.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="px-6 py-4"><span className="flex items-center gap-2 text-slate-300">{source.type === 'keyword' ? <Hash size={16} className="text-sky-400" /> : <Globe size={16} className="text-emerald-400" />}{source.type}</span></td>
                          <td className="px-6 py-4 font-medium text-white">{source.value}</td>
                          <td className="px-6 py-4"><span className={`px-2.5 py-1 rounded-full text-[10px] uppercase font-bold border ${getStatusColor(source.status)}`}>{source.status}</span></td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-sky-400 to-purple-500" style={{ width: `${scoreToPercent(source.score ?? 0)}%` }} />
                              </div>
                              <span className="text-slate-400 font-mono">{(source.score ?? 0).toFixed(1)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4"><button onClick={() => handleDeleteSource(source.id)} className="text-slate-600 hover:text-red-400 transition-colors"><Trash2 size={15} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── ソース分析 ── */}
          {activeTab === 'performance' && (
            <motion.div key="performance" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
              <div className="grid grid-cols-3 gap-6 mb-2">
                {[
                  { label: '総収集件数', value: collectedItems.length, color: 'text-sky-400' },
                  { label: 'お気に入り登録', value: collectedItems.filter(i => i.isFavorited).length, color: 'text-amber-400' },
                  { label: '稼働中キーワード', value: sourcesList.filter(s => s.status === 'active').length, color: 'text-emerald-400' },
                ].map((s, i) => (
                  <div key={i} className="glass-card text-center py-6">
                    <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">{s.label}</p>
                    <p className={`text-4xl font-bold font-outfit ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              <div className="glass-card overflow-hidden">
                <h3 className="text-lg font-bold font-outfit px-6 pt-6 pb-4 flex items-center gap-2">
                  <Zap size={20} className="text-amber-400" /> キーワード別パフォーマンス（収集数順）
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-slate-400 uppercase bg-white/5 border-b border-white/5">
                      <tr>
                        <th className="px-6 py-4">キーワード</th>
                        <th className="px-6 py-4">ステータス</th>
                        <th className="px-6 py-4">スコア</th>
                        <th className="px-6 py-4">収集数</th>
                        <th className="px-6 py-4">最終ヒット</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoadingData ? (
                        <tr><td colSpan={5} className="text-center py-8 text-sky-400"><Activity className="animate-pulse mx-auto" /></td></tr>
                      ) : sourcePerformance.map((src: any) => (
                        <tr key={src.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="px-6 py-4 font-medium text-white flex items-center gap-2"><Hash size={14} className="text-sky-400 flex-shrink-0" />{src.value}</td>
                          <td className="px-6 py-4"><span className={`px-2.5 py-1 rounded-full text-[10px] uppercase font-bold border ${getStatusColor(src.status)}`}>{src.status}</span></td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-12 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-sky-400 to-purple-500" style={{ width: `${scoreToPercent(src.score ?? 0)}%` }} />
                              </div>
                              <span className="text-slate-400 font-mono text-xs">{(src.score ?? 0).toFixed(1)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4"><span className={`font-bold font-mono ${Number(src.collectedCount) > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>{src.collectedCount ?? 0}件</span></td>
                          <td className="px-6 py-4 text-slate-400 text-xs">{src.lastHitAt ? new Date(src.lastHitAt).toLocaleDateString('ja-JP') : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* キーワード × カテゴリ 共起ヒートマップ */}
              {kwMatrix.keywords.length > 0 && (
                <div className="glass-card">
                  <h3 className="text-lg font-bold font-outfit px-6 pt-6 pb-4 flex items-center gap-2">
                    <TrendingUp size={20} className="text-emerald-400" /> キーワード×カテゴリ 共起ヒートマップ
                  </h3>
                  <div className="px-6 pb-6 overflow-x-auto">
                    <div className="flex items-center gap-1 mb-2 ml-32">
                      {kwMatrix.categories.map(cat => (
                        <div key={cat} className="w-16 text-[9px] text-slate-500 text-center truncate" title={cat}>{cat.replace('/フレームワーク', '').replace('ビジネス応用', 'ビジネス').replace('研究/論文', '研究')}</div>
                      ))}
                    </div>
                    {kwMatrix.matrix.map((row: any) => (
                      <div key={row.keyword} className="flex items-center gap-1 mb-1">
                        <div className="w-32 text-xs text-slate-300 truncate font-medium pr-2" title={row.keyword}>{row.keyword}</div>
                        {row.data.map((cnt: number, ci: number) => {
                          const intensity = cnt > 0 ? Math.min(1, cnt / kwMatrix.maxCount) : 0;
                          return (
                            <div key={ci} className="w-16 h-7 rounded flex items-center justify-center text-xs font-bold"
                              style={{ backgroundColor: `rgba(99,102,241,${intensity * 0.85})`, color: intensity > 0.4 ? 'white' : '#64748b' }}
                              title={`${kwMatrix.categories[ci]}: ${cnt}件`}>
                              {cnt > 0 ? cnt : ''}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Right Sidebar - Gemini Chat */}
      <aside className="w-80 border-l border-white/5 bg-black/20 flex flex-col flex-shrink-0 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-sky-500/5 to-purple-500/5 pointer-events-none" />
        <div className="p-6 border-b border-white/5 flex items-center gap-3 relative z-10 bg-black/40 backdrop-blur-md">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-400 to-purple-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/20">
            <Sparkles size={20} />
          </div>
          <div>
            <h3 className="font-bold font-outfit text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-purple-400">Gemini</h3>
            <p className="text-[10px] text-slate-400">2.5 Flash Lite · DB文脈あり</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 relative z-10">
          {messages.length === 0 && (
            <div className="text-center text-slate-500 text-sm mt-10">
              <Sparkles size={32} className="mx-auto mb-3 text-sky-400/50" />
              <p>収集データや最新AI技術について<br />何でも質問してください。</p>
            </div>
          )}
          {messages.map(m => {
            const textContent = Array.isArray((m as any).parts)
              ? (m as any).parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
              : (m as any).content ?? '';
            return (
              <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${m.role === 'user' ? 'bg-white/10 text-slate-300' : 'bg-gradient-to-br from-sky-400 to-purple-500 text-white shadow-md'}`}>
                  {m.role === 'user' ? <User size={16} /> : <Sparkles size={16} />}
                </div>
                <div className={`p-3 rounded-2xl max-w-[80%] text-sm leading-relaxed ${m.role === 'user' ? 'bg-white/10 text-slate-200 rounded-tr-sm' : 'bg-gradient-to-br from-sky-500/10 to-purple-500/10 border border-white/5 text-slate-200 rounded-tl-sm'}`}>
                  {textContent}
                </div>
              </div>
            );
          })}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-sky-400 to-purple-500 text-white shadow-md">
                <Sparkles size={16} className="animate-pulse" />
              </div>
              <div className="p-3 rounded-2xl bg-white/5 text-slate-400 text-sm rounded-tl-sm flex items-center gap-2 border border-white/5">
                <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" />
                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-white/5 bg-black/40 backdrop-blur-md relative z-10">
          <form onSubmit={e => { e.preventDefault(); if (!chatInput.trim() || isLoading) return; sendMessage({ text: chatInput }); setChatInput(''); }} className="relative">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Geminiに質問する..."
              className="w-full bg-white/5 border border-white/10 rounded-full py-3 pl-4 pr-12 text-sm text-white focus:outline-none focus:border-purple-500/50 transition-colors shadow-inner" />
            <button type="submit" disabled={isLoading || !chatInput.trim()}
              className="absolute right-1.5 top-1.5 p-2 bg-gradient-to-r from-sky-500 to-purple-500 text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-md">
              <Send size={14} />
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}
