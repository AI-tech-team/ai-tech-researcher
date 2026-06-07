// 一覧からレポートをタップした瞬間に出る、オーバーレイの骨組み（即時フィードバック）。
export default function ReportOverlayLoading() {
  return (
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-[70] overflow-y-auto bg-[#03060f]">
      <header className="sticky top-0 z-10 backdrop-blur-md bg-[#03060f]/85 border-b border-white/5">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white/10 animate-pulse" />
            <div className="h-3.5 w-28 rounded bg-white/10 animate-pulse" />
          </div>
          <div className="h-4 w-12 rounded bg-white/10 animate-pulse" />
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-3 sm:px-5 py-6 sm:py-8">
        <div className="rounded-2xl border border-white/10 bg-[#070b16] p-6 space-y-4">
          <div className="h-3 w-32 rounded bg-white/10 animate-pulse" />
          <div className="h-6 w-1/2 rounded bg-white/10 animate-pulse" />
          <div className="pt-3 space-y-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-3.5 rounded bg-white/[0.06] animate-pulse" style={{ width: `${92 - (i % 4) * 10}%` }} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
