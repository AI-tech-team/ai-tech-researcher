import { notFound } from 'next/navigation';
import { getReportById } from '@/app/actions';
import { ReportView } from '@/components/ReportView';
import { ModalShell } from '@/components/ModalShell';

// 一覧から /reports/[id] へソフト遷移したときだけ発火するインターセプト。
// レポートを全画面オーバーレイで表示し、裏のトップ(一覧)は保持＝戻っても再読み込みしない。
export default async function ReportModalRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReportById(Number(id));
  if (!report) notFound();

  return (
    <ModalShell>
      <ReportView report={report} />
    </ModalShell>
  );
}
