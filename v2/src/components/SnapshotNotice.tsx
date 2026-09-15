import { SNAPSHOT_MODE } from '@/lib/site';
// ⚠ 日付のためにスナップショット本体(数MB)を読み込まない。軽量な id ファイルに同じ日付を入れてある。
import meta from '@/data/snapshot-ids.json';
import s from '@/styles/brand.module.css';

/**
 * 延命モード（SNAPSHOT_MODE）であることを読者に伝える1行。
 *
 * 2026-09-15、Turso Free の月500M行読み取りを使い切って読み取りが `BLOCKED` になった。
 * リセットはカレンダー月なので10月1日まで戻らない。その間サイトを黙らせないために、
 * 静的スナップショットを配っている。
 *
 * ⚠ 黙って古いものを配らない。読者から見れば「更新が止まっているのか、壊れているのか、
 *   自分の見ている画面が古いのか」が区別できない。日付を明示して、
 *   こちらの都合であることと、いつ再開するかを1行で言う。
 *   [[feedback-subtraction]] に従い、帯は1本だけ・閉じるボタンも付けない（増やさない）。
 *
 * ⚠ 文面は実態に合わせること。当初は「収集と配信を一時休止しています」と書いたが、
 *   その後 Actions 内のローカルSQLiteで朝刊の発行と配信を再開したので嘘になった（2026-09-15）。
 *   いま本当に止まっているのは「検索の精度」と「トピック（知識グラフ）」の2つだけ。
 */
export function SnapshotNotice() {
  if (!SNAPSHOT_MODE) return null;
  const date = String(meta.latestReportDate || meta.dataDate || '').replace(/-/g, '/');
  return (
    <aside
      role="status"
      className={s.band}
      style={{ paddingBlock: 14, borderBottom: '1px solid color-mix(in srgb, currentColor 18%, transparent)' }}
    >
      <div className={s.measure}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, opacity: 0.85 }}>
          <strong>{date} 号まで掲載しています。</strong>
          {' '}データベースの月間上限に達したため、いまは1日数回更新の簡易版で配信しています。
          朝刊は毎朝これまで通り出ます。検索とトピックは10月1日に元に戻ります。
        </p>
      </div>
    </aside>
  );
}
