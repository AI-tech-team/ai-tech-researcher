import { renderEntityOgImage, OG_SIZE } from '@/lib/ogImage';
import { SITE_NAME } from '@/lib/site';

// トピック一覧の OG画像。ここの metadata が openGraph を上書きしているため、
// ルートの /opengraph-image が継承されず og:image が無くなっていた（2026-09-12 実測）。
// URLがASCII固定（/topic）なので ISR を使ってよい＝トピック個別ページと違い 500 の罠が無い。
export const revalidate = 86400;
export const alt = `${SITE_NAME} のトピック一覧`;
export const size = OG_SIZE;
export const contentType = 'image/png';

export default async function Image() {
  return renderEntityOgImage({
    kicker: 'トピック',
    title: '追跡しているAIモデル・企業・技術',
    accent: '#7dd3fc',
  });
}
