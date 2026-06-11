import type { Metadata } from 'next';
import Link from 'next/link';
import { BrainCircuit, ArrowLeft, Activity, Newspaper, Radio, Network, Boxes, Clock } from 'lucide-react';
import { SITE_NAME } from '@/lib/site';
import { getSystemStatus } from '@/app/actions';

export const metadata: Metadata = {
  title: '稼働状況',
  description: `${SITE_NAME} の稼働状況・最終更新・収集規模を公開しています。`,
};

// 公開ホットパス。数値は約30分キャッシュ（毎アクセスでDBを叩かない）。
export const revalidate = 1800;

// JSTの今日（YYYY-MM-DD）
function jstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
// 'YYYY-MM-DD' 同士の日数差（b - a）
function dayDiff(a: string, b: string): number | null {
  const da = Date.parse(`${a}T00:00:00Z`), dbb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(dbb)) return null;
  return Math.round((dbb - da) / 86400000);
}
// UTC空白区切りの created_at を JST 表示に
function fmtJst(s: string | null): string {
  if (!s) return '—';
  const d = new Date(`${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 sm:p-5">
      <div className="flex items-center gap-1.5 text-slate-400 mb-1.5">{icon}<span className="text-[11px] font-medium">{label}</span></div>
      <p className="text-xl sm:text-2xl font-bold text-white font-outfit tabular-nums">{value}</p>
    </div>
  );
}

export default async function StatusPage() {
  const s = await getSystemStatus();
  const today = jstToday();
  const diff = s.reports.daily ? dayDiff(s.reports.daily, today) : null;
  const health =
    diff == null ? { label: '確認中', dot: '#f59e0b', text: 'text-amber-300', ring: 'border-amber-400/20 bg-amber-400/[0.06]' }
    : diff <= 1 ? { label: '正常に稼働中', dot: '#10b981', text: 'text-emerald-300', ring: 'border-emerald-400/20 bg-emerald-400/[0.06]' }
    : diff === 2 ? { label: 'やや遅延', dot: '#f59e0b', text: 'text-amber-300', ring: 'border-amber-400/20 bg-amber-400/[0.06]' }
    : { label: '更新が遅延しています', dot: '#f43f5e', text: 'text-rose-300', ring: 'border-rose-400/20 bg-rose-400/[0.06]' };
  const nf = (n: number) => n.toLocaleString('ja-JP');

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#03060f]/85 border-b border-white/5">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-5 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <BrainCircuit className="text-white" size={15} />
            </div>
            <span className="font-bold text-sm font-outfit">{SITE_NAME}</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> トップ
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-10 sm:py-14">
        <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-sky-400/80 flex items-center gap-1.5"><Activity size={12} />Status</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-outfit leading-tight mt-2">稼働状況</h1>
        <p className="text-sm text-slate-400 leading-relaxed mt-4">
          {SITE_NAME} は毎朝 6:00（JST）に自動でニュースを収集・要約し、レポートを生成します。現在の状態と収集規模を公開しています。
        </p>

        {/* 健全性 */}
        <div className={`mt-6 rounded-2xl border ${health.ring} p-5 flex items-center gap-3`}>
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ backgroundColor: health.dot }} />
            <span className="relative inline-flex rounded-full h-3 w-3" style={{ backgroundColor: health.dot }} />
          </span>
          <div className="min-w-0">
            <p className={`text-sm font-bold ${health.text}`}>{health.label}</p>
            <p className="text-[12px] text-slate-400 mt-0.5">
              最新の日次レポート: <span className="text-slate-300">{s.reports.daily ?? '—'}</span>
              <span className="text-slate-600"> · </span>
              最終収集: <span className="text-slate-300">{fmtJst(s.lastCollectedAt)}</span>
            </p>
          </div>
        </div>

        {/* 規模 */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <Stat icon={<Newspaper size={14} />} label="収集した記事" value={nf(s.articles)} />
          <Stat icon={<Radio size={14} />} label="稼働中の情報源" value={nf(s.activeSources)} />
          <Stat icon={<Boxes size={14} />} label="抽出エンティティ" value={nf(s.entities)} />
          <Stat icon={<Network size={14} />} label="知識グラフの関係" value={nf(s.relations)} />
        </div>

        {/* レポート最終生成 */}
        <div className="mt-4 rounded-2xl border border-white/5 bg-white/[0.02] p-5">
          <div className="flex items-center gap-1.5 text-slate-400 mb-3"><Clock size={14} /><span className="text-[11px] font-medium">レポート最終生成</span></div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {([['日次', s.reports.daily], ['週次', s.reports.weekly], ['月次', s.reports.monthly]] as const).map(([k, v]) => (
              <div key={k}>
                <p className="text-[11px] text-slate-500">{k}</p>
                <p className="text-sm font-bold text-slate-200 font-outfit tabular-nums mt-0.5">{v ?? '—'}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[12px] text-slate-500 leading-relaxed mt-6">
          数値は約30分ごとに更新されます。要約・分析はAIによる生成物で、誤りを含む可能性があります。仕組みの詳細は{' '}
          <Link href="/about" scroll={false} className="text-sky-400 hover:text-sky-300 underline underline-offset-2">このサービスについて</Link>{' '}をご覧ください。
        </p>

        <footer className="mt-12 pt-6 border-t border-white/5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500">
            <Link href="/about" scroll={false} className="hover:text-slate-300 transition-colors">サービスについて</Link>
            <span className="text-slate-700">·</span>
            <Link href="/privacy" scroll={false} className="hover:text-slate-300 transition-colors">プライバシー</Link>
            <span className="text-slate-700">·</span>
            <Link href="/changelog" scroll={false} className="hover:text-slate-300 transition-colors">更新履歴</Link>
          </div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> トップに戻る
          </Link>
        </footer>
      </main>
    </div>
  );
}
