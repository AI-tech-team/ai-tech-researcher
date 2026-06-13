import { renderEntityOgImage, OG_SIZE } from '@/lib/ogImage';
import { getReportById } from '@/app/actions';

// レポート個別ページの動的OG画像（X/はてブ/Slack等のカード用）。
// 公開済みレポートは内容不変なのでISRでキャッシュ（毎クロールでDB/フォントを叩かない）。
export const revalidate = 86400;
export const alt = 'Knowledge Tree のレポート';
export const size = OG_SIZE;
export const contentType = 'image/png';

const TYPE_LABEL: Record<string, string> = { daily: 'デイリーレポート', weekly: '週次レポート', monthly: '月次レポート' };

// レポート本文(markdown)の先頭見出しを主役タイトルに使う。装飾記号は剥がす。
function headlineOf(content: string | null, fallback: string): string {
  const m = content?.match(/^#{1,3}\s+(.+)$/m);
  const raw = (m?.[1] ?? '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  return raw || fallback;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReportById(Number(id));
  const label = report ? (TYPE_LABEL[report.type] ?? 'レポート') : 'レポート';
  const kicker = report?.reportDate ? `${label} · ${report.reportDate}` : label;
  const title = headlineOf(report?.content ?? null, `${label}${report?.reportDate ? ` ${report.reportDate}` : ''}`);
  return renderEntityOgImage({ kicker, title, accent: '#34d399' });
}
