/**
 * 一次情報源（研究所・モデル提供元の公式発表）のホスト一覧。
 *
 * 朝刊の候補選定と知識抽出は「★9以上」で揃えているが、重要度スコアは横並びで付くため、
 * 実測（2026-09-12・直近14日）では OpenAI / HuggingFace / DeepMind 等の43%が★8に落ちていた。
 * ★9で硬く切ると、この30本（約2本/日）を毎日捨てることになる。だからここに載るホストは
 * ★8から拾う。
 *
 * ホスト名は URL への部分一致で使う（サブドメインを個別に列挙しなくて済むように）。
 */
export const PRIMARY_SOURCE_HOSTS = [
  'openai.com',
  'deepmind.google',
  'huggingface.co',
  'ai.meta.com',
  'engineering.fb.com',
  'mistral.ai',
  'research.google',
  'blog.google',
  'blogs.nvidia.com',
  'blogs.nvidia.co.jp',
  'developer.nvidia.com',
  'pytorch.org',
  'machinelearning.apple.com',
  'microsoft.com',
  'together.ai',
] as const;

/** 朝刊・知識抽出に載せる下限。★9以上、ただし一次情報源は★8から。 */
export const MIN_IMPORTANCE = 9;
export const MIN_IMPORTANCE_PRIMARY = 8;

/** URL が一次情報源かどうか。 */
export function isPrimarySource(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return PRIMARY_SOURCE_HOSTS.some(h => u.includes(h));
}
