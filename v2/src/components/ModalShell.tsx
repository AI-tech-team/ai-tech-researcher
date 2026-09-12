"use client";

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X } from 'lucide-react';
import { SITE_NAME } from '@/lib/site';
import { useScrollLock } from '@/lib/useScrollLock';
import s2 from '@/styles/brand.module.css';

// Tab で辿れる要素。disabled と tabindex="-1" は外す（＝器そのものは輪に入れない）。
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 一覧からのソフト遷移(intercept)で記事/レポートを全画面オーバーレイ表示する汎用シェル。
// 裏のトップ(一覧)は保持されるので、閉じる(戻る)で再読み込みなし＝スクロール位置も維持。
// 高さは 100dvh＋safe-area で、モバイルブラウザのツールバーと協調する（vhのように被らない）。
export function ModalShell({ children, label = '記事の詳細' }: { children: React.ReactNode; label?: string }) {
  const router = useRouter();
  const close = () => router.back();
  const panelRef = useRef<HTMLDivElement>(null);

  // 背面(一覧)のスクロールを止める。body の overflow だけでは iOS Safari で背面が動くため、
  // position:fixed 方式の共通フックを使う（閉じた時にスクロール位置は復元される）。
  useScrollLock(true);

  // フォーカス管理。2026-09-12 の実測では **何も入っていなかった**:
  //   開いた直後の activeElement = 背面のカード / Tab を12回押しても12回とも背面のリンク。
  // つまりキーボードとスクリーンリーダーの読者は、開いた記事に一度も到達できず、
  // スクロールもできない背面のリンクを延々と辿ることになっていた。
  //   ① 開いたら器へフォーカスを移す（role="dialog" + aria-label が読み上げられる）
  //   ② Tab / Shift+Tab をモーダルの中で輪にする
  //   ③ 閉じたら開く前の要素（一覧のカード）へ返す
  useEffect(() => {
    const panel = panelRef.current;
    const opener = document.activeElement as HTMLElement | null;
    panel?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { router.back(); return; }
      if (e.key !== 'Tab' || !panel) return;

      // 実際に画面に出ているものだけを対象にする（表示されていない要素に飛ぶと行方不明になる）。
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) { e.preventDefault(); panel.focus(); return; }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // 背面へ出てしまっている（＝ハンドラが window で拾った）ときは中へ引き戻す。
      if (!active || !panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      // 器(panel)自身から Shift+Tab すると既定では背面へ抜けるので、末尾へ回す。
      else if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // 閉じた先の一覧は保持されているので、開く前の要素はたいてい生きている。
      if (opener?.isConnected) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-[70] overflow-y-auto overscroll-contain bg-[var(--bg-color)]" onClick={close}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className="min-h-full focus:outline-none" onClick={e => e.stopPropagation()}>
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
