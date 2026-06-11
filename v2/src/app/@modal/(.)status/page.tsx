import StatusPage from '@/app/status/page';
import { OverlayShell } from '@/components/OverlayShell';

// 一覧から /status へソフト遷移したときだけ発火するインターセプト（戻る再読み込み防止）。
export const revalidate = 1800;

export default function StatusModalRoute() {
  return (
    <OverlayShell>
      <StatusPage />
    </OverlayShell>
  );
}
