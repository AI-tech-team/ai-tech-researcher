import AboutPage from '@/app/about/page';
import { OverlayShell } from '@/components/OverlayShell';

// 一覧から /about へソフト遷移したときだけ発火するインターセプト（戻る再読み込み防止）。
export default function AboutModalRoute() {
  return (
    <OverlayShell>
      <AboutPage />
    </OverlayShell>
  );
}
