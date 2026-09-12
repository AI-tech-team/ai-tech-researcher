import { renderEntityOgImage, OG_SIZE } from '@/lib/ogImage';
import { ENTITY_TYPE_LABELS, classifyEntityType } from '@/lib/entity-quality';

// トピックページの動的OG画像。2026-09-12 の実測では og:image が無いのは 212/557 URL で、
// その内訳は /topic 204件・/category 7件・/topic 1件だった（記事とレポートには既にある）。
// SNS や Slack に貼ったとき、画像の無い素っ気ないリンクになるのを解消する。
//
// ⚠ ISR（revalidate）を付けてはいけない。キャッシュ可能なルートには `x-next-cache-tags` が付き、
//    暗黙タグにデコード済み pathname がそのまま入るため、日本語トピック名で
//    `Invalid character in header content` (Latin-1) で 500 になる。
//    ページ本体（page.tsx の先頭コメント）が ISR を外したのと同じ理由。
export const dynamic = 'force-dynamic';
export const alt = 'Cernoval のトピック';
export const size = OG_SIZE;
export const contentType = 'image/png';

/** 壊れたパーセントエンコードでも 500 にしない（URLは読者が手で編集できる） */
function safeDecode(v: string): string {
  try { return decodeURIComponent(v); } catch { return v; }
}

export default async function Image({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = safeDecode(name);
  // 種別（モデル/企業…）は名前から決定論で判定できるのでDBは引かない（クロールのたびに叩かない）。
  const label = ENTITY_TYPE_LABELS[classifyEntityType(decoded)];
  return renderEntityOgImage({
    kicker: label ? `トピック · ${label}` : 'トピック',
    title: decoded || 'トピック',
    accent: '#7dd3fc',
  });
}
