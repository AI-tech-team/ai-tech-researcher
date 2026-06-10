'use client';
import { useEffect, useState } from 'react';

// 起動時に一瞬だけブランド（バルブ）を見せるスプラッシュ。PWAスタンドアロンでもブラウザでも効く。
// ハイドレーション後にJSでフェードアウト。JSが動かない/遅い場合もCSSアニメで自動的に消える（閉じ込め防止）。
export function SplashScreen() {
  const [hide, setHide] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHide(true), 850);
    return () => clearTimeout(t);
  }, []);
  return (
    <div aria-hidden className={`splash${hide ? ' splash--hide' : ''}`}>
      {/* 装飾なのでalt空。public/icon-512.png を流用（アプリアイコンと一致） */}
      <img src="/icon-512.png" alt="" width={88} height={88} className="splash__logo" />
    </div>
  );
}
