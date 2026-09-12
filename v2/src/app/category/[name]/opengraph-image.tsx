import { renderEntityOgImage, OG_SIZE, OG_CATEGORY_COLORS } from '@/lib/ogImage';

// カテゴリ一覧の動的OG画像（/category/[name] 7件に og:image が無かった・2026-09-12 実測）。
// カテゴリ名は URL から決まるので DB は引かない＝クロールされても読み取り課金が増えない。
//
// ⚠ ISR（revalidate）を付けてはいけない。カテゴリ名は全て日本語なので、キャッシュ可能に
//    した瞬間 `x-next-cache-tags`（Latin-1）に載らず 500 になる。
//    理由の詳細は topic/[name]/page.tsx の先頭コメント。
export const dynamic = 'force-dynamic';
export const alt = 'Cernoval のカテゴリ';
export const size = OG_SIZE;
export const contentType = 'image/png';

/** 壊れたパーセントエンコードでも 500 にしない（URLは読者が手で編集できる） */
function safeDecode(v: string): string {
  try { return decodeURIComponent(v); } catch { return v; }
}

export default async function Image({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = safeDecode(name);
  return renderEntityOgImage({
    kicker: 'カテゴリ',
    title: decoded ? `${decoded} のニュース` : 'AI・技術ニュース',
    accent: OG_CATEGORY_COLORS[decoded] ?? '#7dd3fc',
  });
}
