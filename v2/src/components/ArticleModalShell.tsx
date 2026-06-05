"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BrainCircuit, X } from 'lucide-react';
import { SITE_NAME } from '@/lib/site';

// インターセプト経由(一覧からのソフト遷移)で記事を全画面オーバーレイ表示する殻。
// 裏のトップ(一覧)は生きたままなので、閉じる(戻る)と再読み込みなしで一覧へ戻る。
// 直リンク/リロード/共有では intercept されず、独立した /articles/[id] ページが表示される。
export function ArticleModalShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const close = () => router.back();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') router.back(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // 背面のスクロールを止める
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#03060f]/95 backdrop-blur-sm" onClick={close}>
      <div className="min-h-full" onClick={e => e.stopPropagation()}>
        <header className="sticky top-0 z-10 backdrop-blur-md bg-[#03060f]/85 border-b border-white/5">
          <div className="max-w-2xl mx-auto flex items-center justify-between px-5 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
                <BrainCircuit className="text-white" size={15} />
              </div>
              <span className="font-bold text-sm font-outfit">{SITE_NAME}</span>
            </Link>
            <button onClick={close} aria-label="閉じる"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
              <X size={16} /> 閉じる
            </button>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-3 sm:px-5 py-6 sm:py-8">
          <article className="rounded-2xl border border-white/10 bg-[#070b16]">
            {children}
          </article>
        </main>
      </div>
    </div>
  );
}
