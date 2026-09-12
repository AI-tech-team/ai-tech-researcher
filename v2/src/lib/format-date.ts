/**
 * 画面に出す日付の整形は**すべてここを通す**。理由はただ一つ、JST固定を1か所で保証するため。
 *
 * ⚠ なぜ共通化したか（2026-09-12 本番実測）:
 *   `toLocaleDateString('ja-JP')` のように `timeZone` を書かないと、実行環境のTZがそのまま出る。
 *   サーバー(Vercel=UTC)は「2026/9/11」、読者のブラウザ(JST)は「2026/9/12」を描くので、
 *   `/articles` から開いた記事**8本中6本**で React error #418（text content mismatch）が発生し、
 *   その記事のハイドレーションが毎回壊れていた。さらにJSTの0〜9時に公開された記事は、
 *   クローラと初回描画に**1日前の日付**が出る＝表示として単純に誤り。
 *   呼び出しごとに `timeZone` を書く運用では必ず1つ書き漏らすので、整形自体を集約する。
 *
 * 無効な日付は空文字を返す。読者に "Invalid Date" を見せないため（表示は落として黙る）。
 */
const JST = 'Asia/Tokyo';

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** 「2026/9/12」。記事詳細のメタ行など、年まで必要な場所で使う。 */
export function formatDateJst(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString('ja-JP', { timeZone: JST }) : '';
}

/** 「9/12」。一覧の行など、年が自明な場所で使う。 */
export function formatMonthDayJst(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString('ja-JP', { timeZone: JST, month: 'numeric', day: 'numeric' }) : '';
}

/** 「9/12 00:19」。初出時刻など、分まで示す場所で使う（ObservedFacts）。 */
export function formatDateTimeJst(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d
    ? d.toLocaleString('ja-JP', { timeZone: JST, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
}
