export function SkeletonCard() {
  return (
    <div className="glass-card animate-pulse">
      <div className="flex justify-between items-start mb-3">
        <div className="h-5 bg-white/10 rounded-lg w-3/4" />
        <div className="flex gap-1.5">
          <div className="h-5 w-5 bg-white/10 rounded" />
          <div className="h-5 w-5 bg-white/10 rounded" />
          <div className="h-5 w-5 bg-white/10 rounded" />
        </div>
      </div>
      <div className="h-3.5 bg-white/5 rounded w-full mb-2" />
      <div className="h-3.5 bg-white/5 rounded w-2/3 mb-4" />
      <div className="flex gap-2">
        <div className="h-6 bg-white/10 rounded-md w-20" />
        <div className="h-6 bg-white/5 rounded-md w-28" />
        <div className="h-6 bg-white/5 rounded-md w-20" />
      </div>
    </div>
  );
}

export function SkeletonStat() {
  return (
    <div className="glass-card animate-pulse">
      <div className="h-9 w-9 bg-white/10 rounded-lg mb-4" />
      <div className="h-3 bg-white/5 rounded w-24 mb-2" />
      <div className="h-8 bg-white/10 rounded w-12" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      <td className="px-6 py-4"><div className="h-4 bg-white/10 rounded w-16 animate-pulse" /></td>
      <td className="px-6 py-4"><div className="h-4 bg-white/10 rounded w-32 animate-pulse" /></td>
      <td className="px-6 py-4"><div className="h-5 bg-white/10 rounded-full w-20 animate-pulse" /></td>
      <td className="px-6 py-4"><div className="h-4 bg-white/10 rounded w-24 animate-pulse" /></td>
      <td className="px-6 py-4"><div className="h-4 bg-white/10 rounded w-4 animate-pulse" /></td>
    </tr>
  );
}
