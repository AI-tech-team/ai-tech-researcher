import type { CollectedItem } from '@/types';
import { formatDateTimeJst } from '@/lib/format-date';

/**
 * 決定④: 記事に添えるのは「数えただけの事実」だけにする。★や重要度スコアは読者に見せない。
 *
 * ⚠ なぜ ★ をやめたか（2026-09-11 実測）:
 *   `importance_score` は1つの列に **3つの尺度が混在**している。
 *     - LLMが採点したもの … 4〜10
 *     - HN由来          … **全部 8以上**（中身を見て付いた8ではない）
 *     - techdrip由来     … **全部 6以上**
 *   なので「★8」と「★7」を並べても比較になっていない。さらに日次レポートの並び順に対する寄与は
 *   隣接ペアの 2.2% だけで、80.7% は published_at が決めていた。
 *   根拠の無い数字を「AIが8点と判定した」ように見せていたので表示をやめる。
 *   **並べ替えには引き続き使う**（内部の編集判断であって、読者への主張ではない）。
 *
 * ⚠ `storyCount` は「同一ストーリーの**記事数**」であって媒体数ではない
 *   （実測: 160件のstoryでも実媒体は6）。表示は必ず「N本の記事」とし「N媒体」と書かない。
 *
 * 経緯: 同じ表示を3ファイル（記事詳細・一覧・検索）にコピーすると必ず1つ取り残すので、ここに集約する。
 */

/** 公開時刻を JST の「9/10 00:19」に。整形は src/lib/format-date.ts に集約してある
 *  （タイムゾーンを明示するのでSSRとクライアントで一致する＝ハイドレーションが壊れない）。 */
function jstShort(iso: string | null | undefined): string | null {
  return formatDateTimeJst(iso) || null;
}

/** この記事について「数えれば出る」事実だけを短い文字列にする。無ければ空配列。 */
export function observedFacts(item: Pick<CollectedItem, 'storyCount' | 'publishedAt'>): string[] {
  const out: string[] = [];
  const n = item.storyCount ?? 1;
  if (n > 1) out.push(`${n}本の記事が同じ件を報じた`);
  const t = jstShort(item.publishedAt);
  if (t) out.push(`初出 ${t}`);
  return out;
}

/**
 * 観測事実のラベル列。★の置き換え。
 * 見た目は置き場所ごとに違うので、色やサイズは親から `className` で渡す。
 */
export function ObservedFacts({
  item, className = '', separator = '·',
}: {
  item: Pick<CollectedItem, 'storyCount' | 'publishedAt'>;
  className?: string;
  separator?: string;
}) {
  const facts = observedFacts(item);
  if (facts.length === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap ${className}`}>
      {facts.map((f, i) => (
        <span key={f} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true" className="opacity-40">{separator}</span>}
          {f}
        </span>
      ))}
    </span>
  );
}
