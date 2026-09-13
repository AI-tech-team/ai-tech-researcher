import { renderEntityOgImage, OG_SIZE, OG_CATEGORY_COLORS } from '@/lib/ogImage';
import { getArticleById } from '@/app/actions';

// 記事個別ページの動的OG画像。タイトル＋カテゴリ（自前生成のメタ）のみ描画する。
// 著作権配慮: 第三者本文(rawContent)は載せない。ISRでキャッシュ。
export const revalidate = 86400;
export const alt = 'Cernoval が選り分けたAI・技術ニュース';
export const size = OG_SIZE;
export const contentType = 'image/png';

// カテゴリ色は lib/ogImage の OG_CATEGORY_COLORS に集約（/category の OG画像と共用）。

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await getArticleById(Number(id));
  const title = article?.titleJa || article?.title || 'AI・技術ニュース';
  const category = article?.category ?? 'AIニュース';
  return renderEntityOgImage({ kicker: category, title, accent: OG_CATEGORY_COLORS[category] ?? '#7dd3fc' });
}
