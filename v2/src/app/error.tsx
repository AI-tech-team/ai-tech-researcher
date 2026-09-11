'use client'; // エラーバウンダリはClient Componentである必要がある

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCw, ArrowLeft } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 本番ではdigestのみがクライアントに渡る。サーバーログ突合用に出力
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex items-center justify-center">
          <span className="font-outfit text-xl tracking-tight">Cernoval</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-bold text-white font-outfit">問題が発生しました</h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            一時的なエラーの可能性があります。もう一度お試しください。
          </p>
          {error.digest && (
            <p className="font-mono text-[10px] text-slate-600">エラーID: {error.digest}</p>
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => reset()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[var(--text-main)] text-[var(--bg-color)] text-sm font-bold hover:opacity-80 transition-opacity">
            <RotateCw size={14} /> もう一度試す
          </button>
          <Link href="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06] text-sm font-bold transition-colors">
            <ArrowLeft size={14} /> トップへ
          </Link>
        </div>
      </div>
    </div>
  );
}
