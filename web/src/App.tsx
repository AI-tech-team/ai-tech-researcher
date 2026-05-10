import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Search, FileText, TrendingUp, Activity, Globe } from 'lucide-react';
import { motion } from 'framer-motion';

const API_BASE = "http://localhost:4000/api";

const App: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'reports' | 'sources'>('reports');

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

  return (
    <div className="min-h-screen p-8">
      <header className="max-w-6xl mx-auto mb-12 flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-bold gradient-text mb-2">AI Tech Researcher</h1>
          <p className="text-slate-400">自ら賢くなる最新AI情報収集基盤</p>
        </div>
        <div className="flex gap-4">
          <button className="btn-primary flex items-center gap-2" onClick={fetchData}>
            <Activity size={18} /> 更新
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
          {[
            { label: 'Active Sources', value: stats?.active_sources, icon: <TrendingUp className="text-sky-400" /> },
            { label: 'Total Articles', value: stats?.total_articles, icon: <Globe className="text-purple-400" /> },
            { label: 'Generated Reports', value: stats?.total_reports, icon: <FileText className="text-emerald-400" /> },
            { label: 'Total Keywords', value: stats?.total_sources, icon: <Search className="text-amber-400" /> },
          ].map((stat, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="glass-card flex flex-col gap-2"
            >
              <div className="flex justify-between items-center text-slate-400 mb-1">
                <span className="text-sm font-medium uppercase tracking-wider">{stat.label}</span>
                {stat.icon}
              </div>
              <span className="text-3xl font-bold">{stat.value ?? '...'}</span>
            </motion.div>
          ))}
        </div>

        {/* Main Content Area */}
        <div className="glass-card min-h-[500px]">
          <div className="flex gap-8 border-b border-slate-700/50 mb-8 pb-4">
            <button 
              onClick={() => setActiveTab('reports')}
              className={`text-lg font-semibold transition-colors ${activeTab === 'reports' ? 'text-sky-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              レポート一覧
            </button>
            <button 
              onClick={() => setActiveTab('sources')}
              className={`text-lg font-semibold transition-colors ${activeTab === 'sources' ? 'text-sky-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              情報ソース管理
            </button>
          </div>

          {activeTab === 'reports' ? (
            <div className="space-y-6">
              {reports.length === 0 && <p className="text-slate-500 text-center py-12">レポートがまだありません。</p>}
              {reports.map((report) => (
                <div key={report.id} className="p-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-sky-400">{report.report_date} {report.type.toUpperCase()} Report</h3>
                    <span className="text-xs text-slate-500">{new Date(report.created_at).toLocaleString()}</span>
                  </div>
                  <div className="text-slate-300 line-clamp-3 overflow-hidden text-sm leading-relaxed whitespace-pre-wrap">
                    {report.content}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-slate-500 text-sm uppercase tracking-wider border-b border-slate-700/50">
                    <th className="pb-4 font-medium">Value</th>
                    <th className="pb-4 font-medium">Type</th>
                    <th className="pb-4 font-medium">Status</th>
                    <th className="pb-4 font-medium text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {sources.map((src) => (
                    <tr key={src.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-4 font-medium">{src.value}</td>
                      <td className="py-4 text-slate-400 text-sm">{src.type}</td>
                      <td className="py-4">
                        <span className={`px-2 py-1 rounded-md text-xs font-bold ${
                          src.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 
                          src.status === 'candidate' ? 'bg-amber-500/20 text-amber-400' : 
                          'bg-slate-500/20 text-slate-400'
                        }`}>
                          {src.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-4 text-right font-mono text-sky-400">{src.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
