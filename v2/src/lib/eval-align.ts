/**
 * LLMのバッチ評価を、元の候補に**番号で**突き合わせる。
 *
 * ⚠ 2026-09-13 に本番で発覚した不具合の対策。それまでは候補と返り値を
 *   **配列の位置だけ**で対応づけていた（`evaluations[i]`）。プロンプト側では
 *   `[0] [1] [2]…` と番号を振っていたのに、スキーマがその番号を返させていなかったので、
 *   番号は飾りでしかなかった。
 *
 *   実物（huggingface daily_papers・6件中3件）:
 *     題「ActReview：…ピアレビュー生成」 ↔ 要約「ROS 2のDDSバックプレッシャーを解決するAdaptive Bridge」
 *     題「多言語の架け橋を築く」        ↔ 要約「行動指向のピアレビュー生成タスクを定義し…」
 *     題「Adaptive Bridge：ROS 2…」   ↔ 要約「数理論理ソルバーに依存する…」
 *   きれいに1つずつ回転していた＝**別記事の要約を付けたまま公開されていた。**
 *
 * ⚠ 件数の一致チェックでは検出できない。件数が合っていても中身が入れ替わるため。
 *   「n件返ってきたから正しい」は、**順序が保たれるという検証していない仮定**に乗っていた。
 *   → [[pattern-wired-but-never-called]] の隣（チェックはあるが、見ている量が違う）
 *
 * 位置へのフォールバックを残す理由: index が欠けた返り値で全件捨てるより、
 * 従来どおりの（ズレうる）対応で出す方がまだ良い（欠落より冗長）。
 */

/** プロンプトの末尾に必ず足す。index を返させないと evalAt() が位置対応に落ちる。 */
export const INDEX_RULE = `\n\n各itemには、上のリストで記事に付いている [番号] を index として必ずそのまま入れてください。順序を入れ替えても構いませんが、index は対応する記事のものにしてください。`;

/** 候補 i 番に対応する評価を返す。番号で突き合わせ、見つからなければ位置に落ちる。 */
export function evalAt<T extends { index?: number }>(evals: T[] | null | undefined, i: number): T | undefined {
  if (!evals?.length) return undefined;
  const hit = evals.find(e => e != null && e.index === i);
  return hit ?? evals[i];
}

/**
 * 番号での突き合わせがどれだけ効いたかを1行で返す（ログ用・判定はしない）。
 * 「index が全部欠けている」「重複している」を**黙って位置対応に落ちる前に**見えるようにする。
 */
export function describeAlignment<T extends { index?: number }>(evals: T[], n: number): string {
  const idx = evals.map(e => e?.index).filter((v): v is number => typeof v === 'number');
  const uniq = new Set(idx);
  const inRange = [...uniq].filter(v => v >= 0 && v < n).length;
  if (idx.length === 0) return `index なし＝位置対応にフォールバック（${evals.length}/${n}件）`;
  if (uniq.size !== idx.length) return `⚠ index が重複（${idx.length}個中ユニーク${uniq.size}個）`;
  if (inRange !== uniq.size) return `⚠ index が範囲外を含む（${uniq.size}個中${inRange}個が有効）`;
  return `index で対応（${inRange}/${n}件）`;
}
