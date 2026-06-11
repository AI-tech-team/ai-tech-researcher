"use client";

import { useState, useSyncExternalStore } from 'react';
import { Share2, Link2, Check } from 'lucide-react';

// navigator.share の有無をSSR/クライアントで食い違わずに読む（サーバはfalse・以後不変）。
const subscribeNoop = () => () => {};
const canShareClient = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';
const canShareServer = () => false;

// 記事/レポート共有ボタン行。はてなブックマーク・X・リンクコピー・(モバイル)ネイティブ共有。
// モーダルと全画面ページの両方で共用。url は自サイトの絶対URL、title は共有時の見出し。
export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = useSyncExternalStore(subscribeNoop, canShareClient, canShareServer);

  const enc = encodeURIComponent;
  const hatena = `https://b.hatena.ne.jp/add?mode=confirm&url=${enc(url)}&title=${enc(title)}`;
  const x = `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* クリップボード不可環境は無視 */ }
  };
  const nativeShare = async () => {
    try { await navigator.share({ title, url }); } catch { /* キャンセル等は無視 */ }
  };

  const base = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 text-xs font-bold transition-colors';
  return (
    <div className="flex items-center gap-2 flex-wrap pt-4 mt-2 border-t border-white/5">
      <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-slate-600 mr-1">
        <Share2 size={12} />Share
      </span>
      <a href={hatena} target="_blank" rel="noopener noreferrer" className={base}>
        <span className="font-bold text-[#00a4de]">B!</span> はてブ
      </a>
      <a href={x} target="_blank" rel="noopener noreferrer" className={base}>
        <span className="font-bold">𝕏</span> ポスト
      </a>
      <button onClick={copy} className={base}>
        {copied ? <><Check size={13} className="text-emerald-400" /> コピー済み</> : <><Link2 size={13} /> リンク</>}
      </button>
      {canShare && (
        <button onClick={nativeShare} className={base}><Share2 size={13} /> 共有</button>
      )}
    </div>
  );
}
