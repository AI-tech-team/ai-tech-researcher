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

/**
 * LLMが返してきた `id` を、**そのバッチで渡した id だけ**に絞る。
 *
 * ⚠ 2026-09-14 の点検で見つけた、上の位置対応と同じ家系の穴。
 *   翻訳・要点生成の4経路（translateTitles / translateSummaries / generateKeyPoints /
 *   translateClaims）は `.where(eq(table.id, it.id))` と、**モデルが返した数値を
 *   そのまま主キーにして UPDATE** していた。渡した25件のどれでもない id が返れば、
 *   無関係な行の summary や keyPoints を上書きして元の値を消す。
 *   位置で突き合わせるのをやめても、**キーを検証していなければ結局モデルを信じている**。
 *
 *   件数チェックでは見つからない（件数は合ったまま中身だけ別行に飛ぶ）のも前回と同じ。
 *
 * 重複も落とす。同じ id が2回返ると「最後の1件が黙って勝つ」＝どちらが採用されたか
 * ログにも残らないため、両方捨てて件数に出す方が安全側（書き込みは回復不能）。
 */
export function acceptKnownIds<T extends { id: number }>(
  items: T[] | null | undefined,
  allowed: Iterable<number>,
): { ok: T[]; unknown: number; duplicated: number } {
  const allow = allowed instanceof Set ? allowed : new Set(allowed);
  const seen = new Set<number>();
  const dup = new Set<number>();
  let unknown = 0;
  const kept: T[] = [];
  for (const it of items ?? []) {
    if (it == null || typeof it.id !== 'number' || !allow.has(it.id)) { unknown++; continue; }
    if (seen.has(it.id)) { dup.add(it.id); continue; }
    seen.add(it.id);
    kept.push(it);
  }
  const ok = dup.size === 0 ? kept : kept.filter(it => !dup.has(it.id));
  return { ok, unknown, duplicated: dup.size };
}

/** acceptKnownIds の結果を1行で表す（問題が無ければ空文字＝ログを汚さない） */
export function describeIdMatch(r: { unknown: number; duplicated: number }): string {
  const parts: string[] = [];
  if (r.unknown) parts.push(`渡していないid ${r.unknown}件`);
  if (r.duplicated) parts.push(`重複id ${r.duplicated}種`);
  return parts.length ? ` ⚠ 破棄: ${parts.join(' / ')}` : '';
}
