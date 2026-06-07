// ナビゲーション中の即時フィードバック。/ のSSR取得中に骨組みを出す
// （/about等から / へ戻った時に「押した瞬間」反応する＝固まって見えるのを防ぐ）。
// 記事/レポートの直リンクには各ルートのloading.tsxが優先されるため、これは主にホーム用。
export default function HomeLoading() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#03060f]/85 backdrop-blur-md">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 sm:px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white/10 animate-pulse" />
            <div className="h-3.5 w-32 rounded bg-white/10 animate-pulse" />
          </div>
          <div className="h-7 w-20 rounded-lg bg-white/10 animate-pulse" />
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        <div className="h-44 rounded-3xl border border-white/5 bg-white/[0.02] animate-pulse" />
        <div className="space-y-4">
          <div className="h-4 w-28 rounded bg-white/10 animate-pulse" />
          <div className="grid grid-cols-1 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
