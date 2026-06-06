import TermsPage from '@/app/terms/page';
import { OverlayShell } from '@/components/OverlayShell';

// 一覧から /terms へソフト遷移したときだけ発火するインターセプト（戻る再読み込み防止）。
export default function TermsModalRoute() {
  return (
    <OverlayShell>
      <TermsPage />
    </OverlayShell>
  );
}
