import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Search, FileText, TrendingUp, Activity, Globe, LayoutGrid, Database, Terminal, ChevronRight, BarChart3, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

const API_BASE = "http://localhost:4000/api";

const App: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'reports' | 'sources'>('overview');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [sRes, srcRes, repRes] = await Promise.all([
        axios.get(`${API_BASE}/stats`),
        axios.get(`${API_BASE}/sources`),
        axios.get(`${API_BASE}/reports`)
      ]);
      setStats(sRes.data);
      setSources(srcRes.data);
      setReports(repRes.data);
    } catch (e) {
      console.error("Failed to fetch data", e);
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

  const sourceDistribution = sources.reduce((acc: any, curr) => {
    acc[curr.status] = (acc[curr.status] || 0) + 1;
    return acc;
  }, {});

  const statusMap: any = {
    'active': '稼働中',
    'candidate': '候補',
    'low-priority': '低優先度'
  };

  const chartData = Object.keys(sourceDistribution).map(key => ({
    name: statusMap[key] || key.toUpperCase(),
    value: sourceDistribution[key]
  }));

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-72 border-r border-white/5 p-6 flex flex-col gap-8">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Terminal className="text-white" size={24} />
          </div>
          <div>
            <h2 className="font-bold text-lg font-outfit leading-tight">AI Researcher</h2>
            <span className="text-xs text-sky-400 font-medium tracking-widest uppercase">自律型技術調査</span>
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
      <main className="flex-1 p-10 overflow-y-auto">
        <header className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-3xl font-bold font-outfit mb-1 capitalize">
              {activeTab === 'overview' ? '全体概要' : activeTab === 'reports' ? '調査レポート' : '情報ソース管理'}
            </h1>
            <p className="text-slate-500 text-sm">自ら学習し、進化する次世代の情報収集基盤</p>
          </div>
          <button className="btn-primary flex items-center gap-2" onClick={fetchData}>
            <Activity size={18} /> データ同期
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
              {/* Stats Cards */}
              <div className="grid grid-cols-4 gap-6">
                {[
                  { label: '有効な情報源', value: stats?.active_sources, color: 'text-sky-400', icon: <TrendingUp size={20}/> },
                  { label: '収集データ件数', value: stats?.total_articles, color: 'text-purple-400', icon: <Globe size={20}/> },
                  { label: '生成レポート数', value: stats?.total_reports, color: 'text-emerald-400', icon: <FileText size={20}/> },
                  { label: '追跡キーワード', value: stats?.total_sources, color: 'text-amber-400', icon: <Search size={20}/> },
                ].map((stat, idx) => (
                  <div key={idx} className="glass-card">
                    <div className="flex justify-between items-start mb-4">
                      <div className={`p-2 rounded-lg bg-white/5 ${stat.color}`}>{stat.icon}</div>
                      <span className="text-emerald-400 text-xs font-bold bg-emerald-400/10 px-2 py-1 rounded">+12%</span>
                    </div>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{stat.label}</p>
                    <h3 className="text-3xl font-bold font-outfit">{stat.value ?? '0'}</h3>
                  </div>
                ))}
              </div>

              {/* Charts Section */}
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
                      <Bar dataKey="value" fill="#818cf8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'reports' && (
            <motion.div 
              key="reports"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              {reports.map((report) => (
                <div key={report.id} className="glass-card hover:translate-y-[-4px] group">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-emerald-400">
                        <FileText size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg font-outfit">{report.type === 'daily' ? '日次' : '週次'}インサイト</h3>
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          <Clock size={12} /> {report.report_date}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="text-slate-600 group-hover:text-sky-400 transition-colors" />
                  </div>
                  <p className="text-slate-300 text-sm leading-relaxed line-clamp-4 whitespace-pre-wrap">
                    {report.content}
                  </p>
                  <div className="mt-6 pt-6 border-t border-white/5 flex justify-between items-center">
                    <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">レポートID: {report.id}</span>
                    <button className="text-sky-400 text-xs font-bold hover:underline">詳細を見る</button>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {activeTab === 'sources' && (
            <motion.div 
              key="sources"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="glass-card"
            >
              <table className="w-full">
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase tracking-[0.2em] font-bold border-b border-white/5">
                    <th className="pb-6 text-left">収集対象（ドメイン/値）</th>
                    <th className="pb-6 text-left">カテゴリ</th>
                    <th className="pb-6 text-left">ステータス</th>
                    <th className="pb-6 text-right">インテリジェンス・スコア</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {sources.map((src) => (
                    <tr key={src.id} className="group hover:bg-white/[0.02] transition-colors">
                      <td className="py-5 font-medium text-slate-200">{src.value}</td>
                      <td className="py-5 text-slate-500 text-sm italic">{src.type}</td>
                      <td className="py-5">
                        <span className={`px-2 py-1 rounded-md text-[10px] font-black tracking-wider ${
                          src.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                          src.status === 'candidate' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 
                          'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                        }`}>
                          {statusMap[src.status] || src.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-5 text-right font-mono text-sky-400 font-bold text-lg">{src.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

export default App;
