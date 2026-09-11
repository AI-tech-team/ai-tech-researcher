import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata = { title: 'ページが見つかりません' };

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex items-center justify-center">
          <span className="font-outfit text-xl tracking-tight">Cernoval</span>
        </div>
        <div className="space-y-2">
          <p className="font-mono text-5xl font-bold text-slate-200">404</p>
          <h1 className="text-lg font-bold text-white font-outfit">ページが見つかりません</h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            お探しのページは移動したか、存在しません。共有リンクの記事が古い場合もあります。
          </p>
        </div>
        <Link href="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[var(--text-main)] text-[var(--bg-color)] text-sm font-bold hover:opacity-80 transition-opacity">
          <ArrowLeft size={14} /> トップに戻る
        </Link>
      </div>
    </div>
  );
}
