import Link from 'next/link';
import { formatIssueDate } from '@/lib/digest';
import { formatReadingTime } from '@/lib/reading-time';
import s from '@/styles/brand.module.css';

/**
 * 号の頭（黒地）。トップと過去の朝刊で共用。
 *
 * ここに出す数字は**数えれば出る事実だけ**にする（決定④）。読了時間は 600字/分の実測、
 * 「N本からM本」は母集団と掲載数。重要度の点数や順位は出さない。
 */
export function IssueHeader({
  eyebrow, title, reportDate, seconds, picked, pool,
}: {
  eyebrow: string;
  title: React.ReactNode;
  reportDate: string | null;
  seconds: number;
  picked: number;
  pool?: number;
}) {
  const date = formatIssueDate(reportDate);
  return (
    <header className={`${s.bandInk} ${s.issue}`}>
      <div className={s.issueInner}>
        <p className={`${s.eyebrow} ${s.eyebrowInk}`}>{eyebrow}</p>
        <h1 className={`${s.displayJp} ${s.issueTitle}`}>{title}</h1>
        <div className={s.issueMeta}>
          {date && <span>{date}</span>}
          {seconds > 0 && <span><b>{formatReadingTime(seconds)}</b>で読めます</span>}
          {pool != null && pool > 0 && picked > 0 && <span><b>{pool}本</b>から<b>{picked}本</b></span>}
        </div>
      </div>
    </header>
  );
}

/** 過去の朝刊（バックナンバー）。号は日付で選ぶので、要約は出さない。 */
export function BackIssues({ issues }: { issues: { id: number; reportDate: string | null }[] }) {
  if (issues.length === 0) return null;
  return (
    <div className={s.backList}>
      {issues.map(r => (
        <Link className={s.backItem} key={r.id} href={`/reports/${r.id}`}>
          <span className={s.backDate}>{formatIssueDate(r.reportDate) || r.reportDate}</span>
          <span className={s.backLabel}>朝刊</span>
          <span className={s.backGo}>読む ›</span>
        </Link>
      ))}
    </div>
  );
}
