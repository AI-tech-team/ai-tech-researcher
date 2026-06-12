import TagPage from '@/app/tag/[name]/page';
import { OverlayShell } from '@/components/OverlayShell';

// 一覧/記事から /tag/[name] へソフト遷移したときだけ発火するインターセプト（戻る再読み込み防止）。
export default function TagModalRoute({ params }: { params: Promise<{ name: string }> }) {
  return (
    <OverlayShell>
      <TagPage params={params} />
    </OverlayShell>
  );
}
