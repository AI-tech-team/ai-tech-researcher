"use client";

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// 情報ページ(feedback/privacy/terms/changelog)を一覧からのソフト遷移(intercept)で
// 全画面オーバーレイ表示する汎用シェル。裏のトップ(/)は children スロットに保持されたままなので、
// 閉じる(戻る/トップ)で再読み込みなし＝スクロール位置も維持される（記事/レポートと同じ挙動）。
// 各ページは自前のヘッダー(ロゴ/トップ導線)を持つので、ここではヘッダーを足さず overlay の器だけ提供する。
export function OverlayShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escで戻る（history.back＝ソフト遷移でトップに復帰）
      if (e.key === 'Escape') window.history.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // ※ body の overflow:hidden ロックはしない。ロックすると裏のトップ(/)の
    //   スクロール位置が失われ、閉じた時に先頭へ飛ぶため。代わりに overscroll-contain で
    //   オーバーレイ内スクロールの背面への波及だけを抑える（位置は保持される）。
  }, []);

  // ページ内の「トップ」リンク(<Link href="/">)は前進ソフト遷移で、Next.jsの並行ルートは
  // この時 @modal スロットを残してしまう（URLは / なのにオーバーレイが消えない不具合）。
  // パスがトップに変わったら自分で閉じる（戻る/Escはスロットが既定に戻るので元から問題なし）。
  if (pathname === '/') return null;

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-[#03060f]">
      {children}
    </div>
  );
}
