import CategoryPage from '@/app/category/[name]/page';
import { OverlayShell } from '@/components/OverlayShell';

// 一覧/記事から /category/[name] へソフト遷移したときだけ発火するインターセプト（戻る再読み込み防止）。
export default function CategoryModalRoute({ params }: { params: Promise<{ name: string }> }) {
  return (
    <OverlayShell>
      <CategoryPage params={params} />
    </OverlayShell>
  );
}
