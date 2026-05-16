"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Search, FileText, TrendingUp, Activity, Globe, LayoutGrid, Database, Terminal, BarChart3, Send, User, ExternalLink, Hash, Clock, Sparkles, Plus, Trash2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar as RechartsBar } from 'recharts';
import { getSourcesData, getCollectedDataList, getReportsData, addSource, deleteSource } from './actions';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'overview' | 'data' | 'reports' | 'sources'>('overview');
  const [sourcesList, setSourcesList] = useState<any[]>([]);
  const [collectedItems, setCollectedItems] = useState<any[]>([]);
  const [reportsList, setReportsList] = useState<any[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [isEvolving, setIsEvolving] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Vercel AI SDK v3 chat hook with DefaultChatTransport
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const isLoading = status === 'streaming' || status === 'submitted';


  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoadingData(true);
    const [sources, data, reportsData] = await Promise.all([
      getSourcesData(),
      getCollectedDataList(),
      getReportsData()
    ]);
    setSourcesList(sources);
    setCollectedItems(data);
    setReportsList(reportsData);
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
      } else {
        alert("同期エラー: " + result.message);
      }
    } catch (e) {
      alert("通信エラーが発生しました");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGenerateReport = async () => {
    if (isGeneratingReport) return;
    setIsGeneratingReport(true);
    try {
      const res = await fetch('/api/report', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        await loadData();
        setActiveTab('reports'); // 生成後レポートタブに移動
      } else {
        alert("レポート生成エラー: " + result.message);
      }
    } catch (e) {
      alert("通信エラーが発生しました");
    } finally {
      setIsGeneratingReport(false);
    }
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

  const handleEvolve = async () => {
    if (isEvolving) return;
    setIsEvolving(true);
    try {
      const res = await fetch('/api/evolve', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        await loadData();
        alert(result.message);
      } else {
        alert("進化エラー: " + result.message);
      }
    } catch {
      alert("通信エラーが発生しました");
    } finally {
      setIsEvolving(false);
    }
  };

  const trendData = [
    { name: '月', value: 40 },
    { name: '火', value: 30 },
    { name: '水', value: 65 },
    { name: '木', value: 45 },
    { name: '金', value: 85 },
    { name: '土', value: 70 },
    { name: '日', value: 90 },
  ];

  const chartData = [
    { name: '稼働中', value: sourcesList.filter(s => s.status === 'active').length || 120 },
    { name: '候補', value: sourcesList.filter(s => s.status === 'candidate').length || 80 },
    { name: '低優先度', value: sourcesList.filter(s => s.status === 'low-priority').length || 12 }
  ];

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'active': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'candidate': return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
      case 'low-priority': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
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
          <button 
            onClick={() => setActiveTab('overview')}
            className={`sidebar-item ${activeTab === 'overview' ? 'active' : ''}`}
          >
            <LayoutGrid size={20} /> 全体概要
          </button>
          <button 
            onClick={() => setActiveTab('data')}
            className={`sidebar-item ${activeTab === 'data' ? 'active' : ''}`}
          >
            <Globe size={20} /> 収集データ
          </button>
          <button 
            onClick={() => setActiveTab('reports')}
            className={`sidebar-item ${activeTab === 'reports' ? 'active' : ''}`}
          >
            <FileText size={20} /> 調査レポート
          </button>
          <button 
            onClick={() => setActiveTab('sources')}
            className={`sidebar-item ${activeTab === 'sources' ? 'active' : ''}`}
          >
            <Database size={20} /> 情報ソース管理
          </button>
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
            <h1 className="text-3xl font-bold font-outfit mb-1 capitalize">
              {activeTab === 'overview' ? '全体概要' : activeTab === 'data' ? '収集データ' : activeTab === 'reports' ? '調査レポート' : '情報ソース管理'}
            </h1>
            <p className="text-slate-500 text-sm">自ら学習し、進化する次世代の情報収集基盤</p>
          </div>
          <button 
            onClick={handleSyncData}
            disabled={isSyncing}
            className={`btn-primary flex items-center gap-2 ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Activity size={18} className={isSyncing ? 'animate-spin' : ''} /> {isSyncing ? '同期中...' : 'データ同期'}
          </button>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div 
              key="overview"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="grid grid-cols-4 gap-6">
                {[
                  { label: '有効な情報源', value: sourcesList.length || 212, color: 'text-sky-400', icon: <TrendingUp size={20}/> },
                  { label: '収集データ件数', value: collectedItems.length || 0, color: 'text-purple-400', icon: <Globe size={20}/> },
                  { label: '生成レポート数', value: reportsList.length || 0, color: 'text-emerald-400', icon: <FileText size={20}/> },
                  { label: '追跡キーワード', value: sourcesList.filter(s => s.type === 'keyword').length || 212, color: 'text-amber-400', icon: <Search size={20}/> },
                ].map((stat, idx) => (
                  <div key={idx} className="glass-card">
                    <div className="flex justify-between items-start mb-4">
                      <div className={`p-2 rounded-lg bg-white/5 ${stat.color}`}>{stat.icon}</div>
                    </div>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{stat.label}</p>
                    <h3 className="text-3xl font-bold font-outfit">{stat.value}</h3>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-8">
                <div className="col-span-2 glass-card h-[400px]">
                  <h3 className="text-lg font-bold font-outfit mb-6 flex items-center gap-2">
                    <BarChart3 size={20} className="text-sky-400" /> 情報収集アクティビティ推移
                  </h3>
                  <ResponsiveContainer width="100%" height="85%">
                    <AreaChart data={trendData}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="name" stroke="#475569" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#475569" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                        itemStyle={{ color: '#38bdf8' }}
                      />
                      <Area type="monotone" dataKey="value" stroke="#38bdf8" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="glass-card h-[400px]">
                  <h3 className="text-lg font-bold font-outfit mb-6 flex items-center gap-2">
                    <Database size={20} className="text-purple-400" /> ソース健全性
                  </h3>
                  <ResponsiveContainer width="100%" height="85%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="name" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                      />
                      <RechartsBar dataKey="value" fill="#818cf8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'data' && (
            <motion.div 
              key="data"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {isLoadingData ? (
                <div className="flex justify-center items-center py-20 text-sky-400">
                  <Activity className="animate-pulse" size={32} />
                </div>
              ) : collectedItems.length > 0 ? (
                <div className="grid grid-cols-1 gap-4">
                  {collectedItems.map(item => (
                    <div key={item.id} className="glass-card group hover:border-sky-500/30">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-lg font-bold text-white group-hover:text-sky-400 transition-colors">{item.title || '無題のデータ'}</h4>
                        {item.url && (
                          <a href={item.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white">
                            <ExternalLink size={16} />
                          </a>
                        )}
                      </div>
                      <p className="text-slate-400 text-sm line-clamp-2 mb-4">{item.summary || 'サマリーはありません'}</p>
                      <div className="flex items-center gap-4 text-xs font-medium">
                        <span className="flex items-center gap-1 text-sky-400 bg-sky-500/10 px-2 py-1 rounded-md">
                          <Hash size={12} /> {item.sourceValue || '不明なソース'}
                        </span>
                        <span className="flex items-center gap-1 text-slate-500">
                          <Clock size={12} /> {new Date(item.createdAt).toLocaleString('ja-JP')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="glass-card text-center py-20 text-slate-400">
                  <Database size={48} className="mx-auto mb-4 opacity-20" />
                  <p>まだ収集されたデータはありません。</p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'reports' && (
            <motion.div 
              key="reports"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex justify-end mb-6">
                <button 
                  onClick={handleGenerateReport}
                  disabled={isGeneratingReport || collectedItems.length === 0}
                  className={`bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-emerald-500/20 hover:opacity-90 transition-opacity ${isGeneratingReport || collectedItems.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Sparkles size={18} className={isGeneratingReport ? 'animate-spin' : ''} />
                  {isGeneratingReport ? 'AIがレポート執筆中...' : '最新レポートをAI生成'}
                </button>
              </div>

              {isLoadingData ? (
                <div className="flex justify-center items-center py-20 text-emerald-400">
                  <Activity className="animate-pulse" size={32} />
                </div>
              ) : reportsList.length > 0 ? (
                <div className="space-y-8">
                  {reportsList.map((report) => (
                    <div key={report.id} className="glass-card border-emerald-500/20 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-4 opacity-10">
                        <FileText size={100} />
                      </div>
                      <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4 relative z-10">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                          <span className="text-emerald-400">■</span> エグゼクティブ・サマリーレポート
                        </h3>
                        <span className="text-sm text-slate-400 bg-white/5 px-3 py-1 rounded-full">
                          {report.reportDate}
                        </span>
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
                  <p className="text-xs text-slate-500">上のボタンをクリックして、収集されたデータからAIにレポートを書かせてください。</p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'sources' && (
            <motion.div
              key="sources"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="flex gap-3">
                <form onSubmit={handleAddKeyword} className="flex gap-2 flex-1">
                  <input
                    value={newKeyword}
                    onChange={e => setNewKeyword(e.target.value)}
                    placeholder="新規キーワードを追加..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-sm text-white focus:outline-none focus:border-sky-500/50"
                  />
                  <button type="submit" className="btn-primary flex items-center gap-2 px-4 py-2">
                    <Plus size={16} /> 追加
                  </button>
                </form>
                <button
                  onClick={handleEvolve}
                  disabled={isEvolving}
                  className="flex items-center gap-2 bg-purple-500/20 border border-purple-500/30 text-purple-300 px-4 py-2 rounded-xl text-sm font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50"
                >
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
                        <th className="px-6 py-4">値 (キーワード / URL)</th>
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
                          <td className="px-6 py-4">
                            <span className="flex items-center gap-2 text-slate-300">
                              {source.type === 'keyword' ? <Hash size={16} className="text-sky-400"/> : <Globe size={16} className="text-emerald-400"/>}
                              {source.type}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-medium text-white">{source.value}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase font-bold border ${getStatusColor(source.status)}`}>
                              {source.status}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-sky-400 to-purple-500" style={{ width: `${Math.min(100, Math.max(0, source.score) * 10)}%` }} />
                              </div>
                              <span className="text-slate-400 font-mono">{(source.score ?? 0).toFixed(1)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() => handleDeleteSource(source.id)}
                              className="text-slate-600 hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Right Sidebar - Gemini */}
      <aside className="w-80 border-l border-white/5 bg-black/20 flex flex-col flex-shrink-0 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-sky-500/5 to-purple-500/5 pointer-events-none" />
        <div className="p-6 border-b border-white/5 flex items-center gap-3 relative z-10 bg-black/40 backdrop-blur-md">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-400 to-purple-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/20">
            <Sparkles size={20} />
          </div>
          <div>
            <h3 className="font-bold font-outfit text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-purple-400">Gemini</h3>
            <p className="text-[10px] text-slate-400">Powered by 3.0 Flash</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 relative z-10">
          {messages.length === 0 && (
            <div className="text-center text-slate-500 text-sm mt-10">
              <Sparkles size={32} className="mx-auto mb-3 text-sky-400/50" />
              <p>私はGeminiです。<br/>データベースにある情報や<br/>最先端の技術について聞いてください。</p>
            </div>
          )}
          {messages.map(m => {
            // v3 UIMessage: parts配列 or content文字列に対応
            const textContent = Array.isArray((m as any).parts)
              ? (m as any).parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
              : (m as any).content ?? '';
            return (
              <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${m.role === 'user' ? 'bg-white/10 text-slate-300' : 'bg-gradient-to-br from-sky-400 to-purple-500 text-white shadow-md'}`}>
                  {m.role === 'user' ? <User size={16} /> : <Sparkles size={16} />}
                </div>
                <div className={`p-3 rounded-2xl max-w-[80%] text-sm leading-relaxed ${
                  m.role === 'user' ? 'bg-white/10 text-slate-200 rounded-tr-sm' : 'bg-gradient-to-br from-sky-500/10 to-purple-500/10 border border-white/5 text-slate-200 rounded-tl-sm'
                }`}>
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
                <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce"></div>
                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/5 bg-black/40 backdrop-blur-md relative z-10">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!chatInput.trim() || isLoading) return;
              sendMessage({ text: chatInput });
              setChatInput('');
            }}
            className="relative"
          >
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Geminiに質問する..."
              className="w-full bg-white/5 border border-white/10 rounded-full py-3 pl-4 pr-12 text-sm text-white focus:outline-none focus:border-purple-500/50 transition-colors shadow-inner"
            />
            <button
              type="submit"
              disabled={isLoading || !chatInput.trim()}
              className="absolute right-1.5 top-1.5 p-2 bg-gradient-to-r from-sky-500 to-purple-500 text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}
