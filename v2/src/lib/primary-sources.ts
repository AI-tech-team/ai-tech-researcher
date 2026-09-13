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
  'blog.eleuther.ai',
  'netflixtechblog.com',
  'engineering.atspotify.com',
] as const;

/** 朝刊・知識抽出に載せる下限。★9以上、ただし一次情報源は★8から。 */
export const MIN_IMPORTANCE = 9;
export const MIN_IMPORTANCE_PRIMARY = 8;

/**
 * **朝刊の候補プールにだけ入れないホスト。**サイト（一覧・検索・トピック）には出す。
 *
 * ⚠ 収集も表示も止めない。止めるのは「今朝の5本」を争う資格だけ。
 *
 * 理由（2026-09-13 実測）: 候補プール（★9以上）の 29.3% が個人投稿だった。
 * 実物を見ると ★9 が付いていたのはこういうものだった:
 *   「52歳・下請け10年の私が、半年でコードを書かなくなった話」★9
 *   「AIセキュリティ何から勉強すりゃええの？その4」★9
 *   「Grok Botを使ってみた話と、1時間で開発組織ができた話」★9
 * 良い記事もあるが**どれも「出来事」ではない**。朝刊は「今朝知るべきAIの動き」なので、
 * 個人の体験談と連載チュートリアルが OpenAI の発表と同じ枠を争うのは設計の誤り。
 * importance_score が「よく書けている」を拾ってしまう型は
 * 「新潟駅徒歩圏で完結する1泊2日観光モデルルート★9」と同じ（[[pattern-llm-cannot-count]] の隣）。
 *
 * ⚠ サイトからは消さない。読み物としては価値があり、消すと検索でも辿れなくなる
 *   （今日決めた「回復可能性で掛ける場所を決める」に従う → src/lib/ai-relevance.ts）。
 */
export const DIGEST_EXCLUDED_HOSTS = [
  'zenn.dev',
  'qiita.com',
  'reddit.com',
  'note.com',
  'medium.com',
  'dev.to',
  'youtube.com',
  'gist.github.com',
] as const;

/** URL が「朝刊には載せないが、サイトには出す」ホストかどうか。 */
export function isDigestExcluded(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return DIGEST_EXCLUDED_HOSTS.some(h => u.includes(h));
}

/** URL が一次情報源かどうか。 */
export function isPrimarySource(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return PRIMARY_SOURCE_HOSTS.some(h => u.includes(h));
}
