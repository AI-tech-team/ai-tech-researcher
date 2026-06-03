import { renderOgImage } from '@/lib/ogImage';

export const alt = 'AI Tech Researcher — 毎日「育つ」AIリサーチ';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return renderOgImage();
}
