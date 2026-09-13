/**
 * Hugging Face のモデルIDから「同じモデルか」を判定する。
 *
 * ⚠ 2026-09-13、`[モデル公開]` の8件中3件が**同じモデル**だった:
 *     Qwen/Qwen3.8-27B                      ★9
 *     ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF  ★7
 *     unsloth/Qwen3.8-27B-GGUF              ★6
 *   量子化して再アップされたものは**別の出来事ではない**。朝刊は「今朝知るべきAIの動き」なので、
 *   同じ公開が3行に増えるのは紙面でも一覧でもノイズになる。
 *   HF trending 30件のうち5件(17%)がこの形だった。
 *
 * ⚠ **収集そのものは止めない。**収集ゲートで落としたものは二度と戻らない
 *   （[[pattern-filter-by-recoverability]]）。派生しかトレンドに乗らない日もあるので、
 *   「派生だから捨てる」ではなく「**本体が既にあるなら重ねない**」で判定する。
 */

/** 量子化・変換版であることを示す名前の印。**著者名では判定しない**（本物の研究組織も再配布するため）。 */
const QUANT_MARKER = /[-._](GGUF|AWQ|GPTQ|MLX|EXL2|EXL3|FP8|FP4|INT4|INT8|W8A8|W4A16|bnb|4bit|8bit|GSQ|RCO|quantized)(?=[-._]|$)/gi;

/** 名前に量子化・変換の印があるか。 */
export function isDerivativeModel(id: string | null | undefined): boolean {
  if (!id) return false;
  QUANT_MARKER.lastIndex = 0;
  return QUANT_MARKER.test(id.split('/').pop() ?? '');
}

/**
 * 「同じモデル」をまとめるためのキー。組織名を外し、量子化の印を削って小文字化する。
 * 例: `unsloth/Qwen3.8-27B-GGUF` と `Qwen/Qwen3.8-27B` → どちらも `qwen3.8-27b`
 */
export function baseModelKey(id: string | null | undefined): string {
  if (!id) return '';
  const name = id.split('/').pop() ?? '';
  return name.replace(QUANT_MARKER, '').replace(/[-._]+$/, '').toLowerCase();
}

/**
 * 同じベースモデルが複数あるとき、残す1件を選ぶ。
 * 本体（派生でないもの）を優先し、同条件なら渡された順（＝trending順）を保つ。
 * 入力の順序は壊さない＝呼び出し側の並びがそのまま意味を持つため。
 */
export function dedupeByBaseModel<T>(items: T[], getId: (t: T) => string): T[] {
  const best = new Map<string, T>();
  for (const it of items) {
    const key = baseModelKey(getId(it));
    if (!key) continue;
    const cur = best.get(key);
    if (!cur) { best.set(key, it); continue; }
    // 既にあるのが派生で、今回が本体なら差し替える
    if (isDerivativeModel(getId(cur)) && !isDerivativeModel(getId(it))) best.set(key, it);
  }
  const keep = new Set(best.values());
  return items.filter(it => keep.has(it));
}
