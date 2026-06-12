import TopicPage from '@/app/topic/[name]/page';
import { OverlayShell } from '@/components/OverlayShell';

// 一覧/記事から /topic/[name] へソフト遷移したときだけ発火するインターセプト（戻る再読み込み防止）。
export default function TopicModalRoute({ params }: { params: Promise<{ name: string }> }) {
  return (
    <OverlayShell>
      <TopicPage params={params} />
    </OverlayShell>
  );
}
