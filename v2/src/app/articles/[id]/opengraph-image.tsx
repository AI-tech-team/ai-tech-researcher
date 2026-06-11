import { renderEntityOgImage, OG_SIZE } from '@/lib/ogImage';
import { getArticleById } from '@/app/actions';

// 記事個別ページの動的OG画像。タイトル＋カテゴリ（自前生成のメタ）のみ描画する。
// 著作権配慮: 第三者本文(rawContent)は載せない。ISRでキャッシュ。
export const revalidate = 86400;
export const alt = 'AI Tech Researcher が収集・要約したAI・技術ニュース';
export const size = OG_SIZE;
export const contentType = 'image/png';

// ArticleDetailContent のカテゴリ色と揃える。
const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': '#38bdf8', 'エージェント': '#818cf8', 'ツール/フレームワーク': '#34d399',
  'ハードウェア': '#fb923c', 'ビジネス応用': '#f472b6', '研究/論文': '#a78bfa', 'その他': '#7dd3fc',
};

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await getArticleById(Number(id));
  const title = article?.titleJa || article?.title || 'AI・技術ニュース';
  const category = article?.category ?? 'AIニュース';
  return renderEntityOgImage({ kicker: category, title, accent: CATEGORY_COLORS[category] ?? '#7dd3fc' });
}
