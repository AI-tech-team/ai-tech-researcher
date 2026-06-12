'use client';
import { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';

// スクロールが進んだら出る「トップへ戻る」ボタン（長尺ページのUX）。
// 全画面ページのwindowスクロールに反応（モーダルは別スクロール＝出ない＝正しい）。
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!show) return null;
  return (
    <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="トップへ戻る"
      className="fixed bottom-5 right-5 z-40 w-10 h-10 rounded-full bg-[#0a0f1e]/90 border border-white/10 backdrop-blur text-slate-300 hover:text-white hover:bg-white/10 shadow-lg flex items-center justify-center transition-colors">
      <ArrowUp size={18} />
    </button>
  );
}
