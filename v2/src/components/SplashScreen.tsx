'use client';
import { useEffect, useState } from 'react';

// 起動スプラッシュ「新芽が育つ」: 電球(ひらめき)の中で芽が伸び→葉が開き→種が灯る＝「毎日育つ」を演出。
// 一度だけ再生し、ハイドレーション後にフェードアウト。JSが動かない/遅い場合もCSSで自動的に消える（閉じ込め防止）。
// 形状は app/icon.png（バルブ＋新芽）と同系のインラインSVGで、各パーツをCSSアニメさせる。
export function SplashScreen() {
  const [hide, setHide] = useState(false);
  useEffect(() => {
    // 芽が育ち切る頃（約1.1s）＋少し余韻を見せてから消す
    const t = setTimeout(() => setHide(true), 1400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div aria-hidden className={`splash${hide ? ' splash--hide' : ''}`}>
      <svg width="132" height="145" viewBox="0 0 100 110">
        <circle className="splash__bglow" cx="50" cy="44" r="30" fill="#22d3ee" opacity="0.2" />
        <g className="splash__bulb">
          <circle cx="50" cy="44" r="26" fill="#0a1326" stroke="#38bdf8" strokeWidth="3.4" />
          <path d="M40 66 L41.5 80 L58.5 80 L60 66 Z" fill="#0a1326" stroke="#38bdf8" strokeWidth="3.4" strokeLinejoin="round" />
          <line x1="43" y1="85" x2="57" y2="85" stroke="#64748b" strokeWidth="2.6" strokeLinecap="round" />
          <line x1="44" y1="90" x2="56" y2="90" stroke="#64748b" strokeWidth="2.6" strokeLinecap="round" />
          <line x1="45" y1="95" x2="55" y2="95" stroke="#64748b" strokeWidth="2.6" strokeLinecap="round" />
        </g>
        <rect className="splash__stem" x="48.4" y="44" width="3.2" height="22" rx="1.6" fill="#34d399" />
        <path className="splash__leafL" d="M50 54 C44 50 37 47 32 49 C35 54 43 55 50 54 Z" fill="#34d399" />
        <path className="splash__leafR" d="M50 50 C56 46 63 43 68 45 C65 50 57 51 50 50 Z" fill="#5fe6ab" />
        <circle className="splash__seed" cx="50" cy="44" r="2.2" fill="#eafff5" />
      </svg>
    </div>
  );
}
