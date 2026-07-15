'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { savePushSubscription, deletePushSubscription } from '@/app/actions';

// VAPID公開鍵。ブラウザに配る性質上これは「公開情報」なので、リポジトリに含めてよい（秘密鍵は別・CIのみ）。
// env で上書き可能。対になる秘密鍵(VAPID_PRIVATE_KEY)をパイプライン側に設定して初めて実際の送信ができる。
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  || 'BAnLx7AVoe04ArEU219ZGfyo04LBvckPFIzqy6YqEIgdJTPX3rBPJVilfZLKJI1iMslT3aGRQjyMRdEsnUxmFB8';

// base64url → Uint8Array（applicationServerKey に渡す形式）
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State = 'unsupported' | 'loading' | 'off' | 'on' | 'denied' | 'busy';

// 日次ダイジェストの通知購読トグル。ログイン不要。
// iOS SafariはPWA(ホーム画面追加)時のみ通知可のため、その旨を案内する。
export function PushToggle({ onDone }: { onDone?: () => void }) {
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    if (!VAPID_PUBLIC) { setState('unsupported'); return; }
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported'); return;
    }
    if (Notification.permission === 'denied') { setState('denied'); return; }
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? 'on' : 'off');
      } catch { setState('off'); }
    })();
  }, []);

  const enable = async () => {
    setState('busy');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Uint8Array<ArrayBufferLike> と DOM の BufferSource の型不一致を吸収（実体は正しいバイト列）
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await savePushSubscription({ endpoint: json.endpoint, keys: json.keys });
      if (!res.success) { await sub.unsubscribe().catch(() => {}); setState('off'); return; }
      setState('on');
      onDone?.();
    } catch {
      setState('off');
    }
  };

  const disable = async () => {
    setState('busy');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscription(sub.endpoint);
        await sub.unsubscribe().catch(() => {});
      }
      setState('off');
    } catch { setState('on'); }
  };

  // 通知を使えない環境ではメニュー項目自体を出さない
  if (state === 'unsupported') return null;

  const base = 'flex items-center gap-2 px-3 py-2 text-[13px] w-full text-left transition-colors';

  if (state === 'denied') {
    return (
      <div className={`${base} text-slate-500`}>
        <BellOff size={14} className="shrink-0" /> 通知はブラウザ側でブロック中
      </div>
    );
  }
  if (state === 'loading' || state === 'busy') {
    return (
      <div className={`${base} text-slate-400`}>
        <Bell size={14} className="shrink-0" /> {state === 'busy' ? '設定中…' : '通知'}
      </div>
    );
  }
  if (state === 'on') {
    return (
      <button onClick={disable} className={`${base} text-slate-200 hover:bg-white/5`}>
        <BellRing size={14} className="shrink-0 text-sky-400" /> 毎朝の通知：オン
      </button>
    );
  }
  return (
    <button onClick={enable} className={`${base} text-slate-200 hover:bg-white/5`}>
      <Bell size={14} className="shrink-0 text-slate-400" /> 毎朝のダイジェストを通知
    </button>
  );
}
