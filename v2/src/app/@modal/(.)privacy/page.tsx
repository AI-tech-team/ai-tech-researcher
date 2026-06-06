import PrivacyPage from '@/app/privacy/page';
import { OverlayShell } from '@/components/OverlayShell';

// 一覧から /privacy へソフト遷移したときだけ発火するインターセプト（戻る再読み込み防止）。
export default function PrivacyModalRoute() {
  return (
    <OverlayShell>
      <PrivacyPage />
    </OverlayShell>
  );
}
