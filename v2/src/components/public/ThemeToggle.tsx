"use client";

import { useSyncExternalStore } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

// 読者のテーマ選択。決定「レイアウトは1つ、テーマは2つ」の切替側。
//
// 状態は「明」「暗」の2つではなく **3つ**（明／暗／端末に合わせる=既定）。
// 既定は html に何も付けず、CSS の prefers-color-scheme に任せる。
// ここで data-theme="light" を貼ってしまうと「端末に合わせる」が選べなくなる。
//
// 初回ペイント前の反映は layout.tsx の THEME_INIT_JS が行う（ここでやるとチラつく）。
type Choice = 'light' | 'dark' | 'system';

const KEY = 'cv_theme';

function read(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; } // プライベートモード等で読めなくても既定に落ちるだけ
}

// useSyncExternalStore で読む。useEffect で setState すると、
// サーバ描画の 'system' → 実値への差し替えが「描画後の状態更新」になり lint に弾かれる。
// スナップショットは同じ値を返し続ける必要があるのでキャッシュする。
let cache: Choice | null = null;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  // 別タブで変更されたときも追随する
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = read(); cb(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

function getSnapshot(): Choice {
  if (cache === null) cache = read();
  return cache;
}

// サーバでは選択が分からない。既定を返し、ハイドレーション後に実値へ差し替わる。
function getServerSnapshot(): Choice { return 'system'; }

function choose(c: Choice) {
  const el = document.documentElement;
  if (c === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', c);
  try {
    if (c === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, c);
  } catch { /* 保存できなくても今の表示は変わる */ }
  cache = c;
  listeners.forEach(l => l());
}

const OPTIONS: { key: Choice; label: string; Icon: typeof Sun }[] = [
  { key: 'light', label: '明るい', Icon: Sun },
  { key: 'system', label: '端末に合わせる', Icon: Monitor },
  { key: 'dark', label: '暗い', Icon: Moon },
];

/**
 * `onDark`: 常に黒い面（ブランドのナビ／その中のメニュー）に置くとき。
 * テーマ変数由来の色は「明」を選んだ読者には暗い色になり、黒地の上で見えなくなるため、
 * その場合だけ literal の色に切り替える。
 */
export function ThemeToggle({ className = '', onDark = false }: { className?: string; onDark?: boolean }) {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div role="group" aria-label="配色"
      className={`flex items-center rounded-lg overflow-hidden ${onDark ? '' : 'border border-white/10'} ${className}`}
      style={onDark ? { border: '1px solid #26262c' } : undefined}>
      {OPTIONS.map(({ key, label, Icon }) => {
        const active = choice === key;
        return (
          <button key={key} type="button" title={label} aria-label={label} aria-pressed={active}
            onClick={() => choose(key)}
            className={onDark
              ? 'px-3 py-2 transition-colors'
              : `px-2 py-1.5 transition-colors ${active
                ? 'bg-sky-500/15 text-sky-400'
                : 'text-slate-600 hover:text-slate-400 hover:bg-white/5'}`}
            style={onDark
              ? { color: active ? '#7dd3fc' : '#8e8e94', background: active ? 'rgba(125,211,252,.14)' : 'transparent' }
              : undefined}>
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
