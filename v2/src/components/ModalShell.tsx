"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X } from 'lucide-react';
import { SITE_NAME } from '@/lib/site';
import { useScrollLock } from '@/lib/useScrollLock';
import s2 from '@/styles/brand.module.css';

// 一覧からのソフト遷移(intercept)で記事/レポートを全画面オーバーレイ表示する汎用シェル。
// 裏のトップ(一覧)は保持されるので、閉じる(戻る)で再読み込みなし＝スクロール位置も維持。
// 高さは 100dvh＋safe-area で、モバイルブラウザのツールバーと協調する（vhのように被らない）。
export function ModalShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const close = () => router.back();

  // 背面(一覧)のスクロールを止める。body の overflow だけでは iOS Safari で背面が動くため、
  // position:fixed 方式の共通フックを使う（閉じた時にスクロール位置は復元される）。
  useScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') router.back(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-[70] overflow-y-auto overscroll-contain bg-[var(--bg-color)]" onClick={close}>
      <div className="min-h-full" onClick={e => e.stopPropagation()}>
        {/* オーバーレイの上端はサイトのナビではなく「閉じる」。ここに全ページ共通のバーを
            置くと、重なっている下の一覧のバーと二重になる（2026-09-12）。 */}
        <header className={s2.sheetBar}>
          <Link href="/" className={s2.sheetBrand}>{SITE_NAME}</Link>
          <button onClick={close} aria-label="閉じる" className={s2.navBtn}>
            <X size={16} /> 閉じる
          </button>
        </header>
        <main className="pb-[max(2rem,env(safe-area-inset-bottom))]">
          {children}
        </main>
      </div>
    </div>
  );
}
