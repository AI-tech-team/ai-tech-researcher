import { Search } from 'lucide-react';

// /search 用の検索ボックス（GETフォーム＝JS不要でサーバ再描画）。
export function SearchBox({ q }: { q?: string }) {
  return (
    <form action="/search" method="get"
      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:border-sky-500/40 transition-colors">
      <Search size={15} className="text-slate-500 shrink-0" />
      <input name="q" defaultValue={q ?? ''} placeholder="記事を検索…" autoComplete="off" maxLength={100}
        className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-600 outline-none" />
      <button type="submit" className="text-xs font-bold text-sky-400 hover:text-sky-300 px-2 shrink-0">検索</button>
    </form>
  );
}
