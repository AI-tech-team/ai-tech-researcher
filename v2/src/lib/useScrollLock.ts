"use client";

import { useEffect } from 'react';

// オーバーレイ表示中に背面(body)のスクロールを止める共通フック。
//
// overflow:hidden だけでは不十分な理由:
//   - iOS Safari は body の overflow:hidden を無視してスクロールしてしまう（背面が動く）。
//   - html 側が残っているとスクロール連鎖(scroll chaining)で背面が動く。
// そこで body を position:fixed + top:-scrollY で固定する（＝背面は物理的に動けない）。
// 解除時に scrollTo で元の位置へ戻すので、閉じてもスクロール位置は失われない
// （OverlayShell がロックを避けていた「閉じると先頭に飛ぶ」問題はこれで解消）。
//
// オーバーレイが重なる場合（例: 検索パレット → 記事モーダル）に片方の解除で
// ロックが外れないよう、参照カウントで管理する。
let lockCount = 0;
let savedScrollY = 0;

export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    if (lockCount === 0) {
      savedScrollY = window.scrollY;
      const s = document.body.style;
      s.position = 'fixed';
      s.top = `-${savedScrollY}px`;
      s.left = '0';
      s.right = '0';
      s.width = '100%';
      s.overflow = 'hidden';
    }
    lockCount++;

    return () => {
      lockCount--;
      if (lockCount > 0) return;
      const s = document.body.style;
      s.position = '';
      s.top = '';
      s.left = '';
      s.right = '';
      s.width = '';
      s.overflow = '';
      window.scrollTo(0, savedScrollY);
    };
  }, [active]);
}
