import Link from 'next/link';
import { BrainCircuit, ArrowLeft } from 'lucide-react';

export const metadata = { title: 'ページが見つかりません' };

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex items-center justify-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <BrainCircuit className="text-white" size={24} />
          </div>
        </div>
        <div className="space-y-2">
          <p className="font-mono text-5xl font-bold text-slate-200">404</p>
          <h1 className="text-lg font-bold text-white font-outfit">ページが見つかりません</h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            お探しのページは移動したか、存在しません。共有リンクの記事が古い場合もあります。
          </p>
        </div>
        <Link href="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-sm font-bold shadow-lg shadow-sky-500/20 hover:opacity-90 transition-opacity">
          <ArrowLeft size={14} /> トップに戻る
        </Link>
      </div>
    </div>
  );
}
