import { renderEntityOgImage, OG_SIZE } from '@/lib/ogImage';
import { getReportById } from '@/app/actions';
import { reportHeadline } from '@/lib/report-headline';

// レポート個別ページの動的OG画像（X/はてブ/Slack等のカード用）。
// 公開済みレポートは内容不変なのでISRでキャッシュ（毎クロールでDB/フォントを叩かない）。
export const revalidate = 86400;
export const alt = 'Cernoval のレポート';
export const size = OG_SIZE;
export const contentType = 'image/png';

const TYPE_LABEL: Record<string, string> = { daily: 'デイリーレポート', weekly: '週次レポート', monthly: '月次レポート' };

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReportById(Number(id));
  const label = report ? (TYPE_LABEL[report.type] ?? 'レポート') : 'レポート';
  const kicker = report?.reportDate ? `${label} · ${report.reportDate}` : label;
  // 見出しの選び方は report-headline.ts に集約（節のラベルが載っていた経緯もそこに記録）。
  const title = reportHeadline(report?.content, `${label}${report?.reportDate ? ` ${report.reportDate}` : ''}`);
  return renderEntityOgImage({ kicker, title, accent: '#34d399' });
}
