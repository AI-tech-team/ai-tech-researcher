import FeedbackPage from '@/app/feedback/page';
import { OverlayShell } from '@/components/OverlayShell';

// 一覧から /feedback へソフト遷移したときだけ発火するインターセプト。
// 全画面オーバーレイで表示し、裏のトップ(/)は保持＝閉じても再読み込みしない・スクロール位置を維持。
export default function FeedbackModalRoute() {
  return (
    <OverlayShell>
      <FeedbackPage />
    </OverlayShell>
  );
}
