import ChangelogPage from '@/app/changelog/page';
import { OverlayShell } from '@/components/OverlayShell';

// 一覧から /changelog へソフト遷移したときだけ発火するインターセプト（戻る再読み込み防止）。
export default function ChangelogModalRoute() {
  return (
    <OverlayShell>
      <ChangelogPage />
    </OverlayShell>
  );
}
