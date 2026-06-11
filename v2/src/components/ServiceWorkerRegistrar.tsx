'use client';
import { useEffect } from 'react';

// Service Worker(/sw.js) を登録する。本番のみ（devはTurbopack/HMRと相性が悪くキャッシュ事故を招くため登録しない）。
// load後に登録して初回描画をブロックしない。失敗は握り潰す（SWはあくまで高速化の付加機能）。
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); };
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);
  return null;
}
