/**
 * タイトル翻訳のプロンプトは `[id] 原題` の形で渡している（daily_pipeline.ts の translateTitles）。
 * LLM はその識別子を訳文にそのまま残すことがあり、本番で **1,732件 / 22,938件（7.6%）** が
 * 「[21984] Meta公式のEvolution API…」の形で保存され、公開面にそのまま出ていた（2026-09-11 実測）。
 *
 * プロンプトで「[N]は含めるな」と頼んでも守られないことがあるので、保存の直前にコードで剥がす。
 *
 * ⚠ 「先頭の[...]を全部消す」にはしない。原題側に `[ERC8107]` `[生成AI Vol.4]` のような
 *    意味のある角括弧があり（本番13件）、それを消すとタイトルが壊れる。
 *    **渡したidと一致する番号のときだけ**剥がす。
 */
const ID_PREFIX = /^\s*\[\s*(\d+)\s*\]\s*/;

export function stripIdPrefix(titleJa: string, id: number): string {
  const m = ID_PREFIX.exec(titleJa);
  if (!m || Number(m[1]) !== id) return titleJa;
  return titleJa.slice(m[0].length);
}
