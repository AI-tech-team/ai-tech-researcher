/**
 * レポートのOGカード（X / Slack / はてブで共有したときに出る画像）に載せる見出しを選ぶ。
 *
 * ⚠ なぜ要るか（2026-09-15 実測）:
 * `opengraph-image.tsx` は「本文の最初の見出し」を採っていた。現行フォーマットでは
 * 最初の見出しが `## 🔥 今日のハイライト` なので、**共有カードに節のラベルが出ていた**。
 * 公開143号のうち **110号（77%）** がこれで、内訳は
 * daily 97号「🔥 今日のハイライト」/ weekly 9号「🏆 今週の3大トピック」/
 * monthly 4号「🏅 今月の重大ニュース TOP5」。
 * 共有された人には、その号が何の話なのか1文字も伝わっていなかった。
 *
 * 規則（143号で検証。節見出しのまま0号 / 空0号）:
 *   1. `###` の見出しのうち、節のラベルでない最初のもの（＝その号の1本目の記事）
 *   2. 無ければ全レベルの見出しのうち節のラベルでない最初のもの
 *   3. 無ければ最初の見出し
 *   4. それも無ければ呼び出し側の既定値
 *
 * `###` を先に見るのは、weekly が本文に `# AI技術動向 週次サマリーレポート` を持っており、
 * それを採るとカード上部の kicker（`週次レポート · 2026-09-13`）と同じことを二度言うため。
 */

/** 節のラベル。記事の見出しではないので主役にしない。 */
const SECTION_LABEL = /(今日のハイライト|今週の3大トピック|今月の重大ニュース|急上昇トレンド|実践的インサイト|まとめ|はじめに|目次)/;

/** 見出しから装飾を剥がす。`### 1. タイトル` の連番も落とす（カードでは順位に意味が無い）。 */
function clean(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\d+[.)]\s*/, '')
    .trim();
}

export function reportHeadline(content: string | null | undefined, fallback: string): string {
  const md = content ?? '';
  const pick = (re: RegExp) => [...md.matchAll(re)].map(m => clean(m[1])).filter(Boolean);
  const h3 = pick(/^###\s+(.+)$/gm);
  const all = pick(/^#{1,3}\s+(.+)$/gm);
  return h3.find(h => !SECTION_LABEL.test(h))
    ?? all.find(h => !SECTION_LABEL.test(h))
    ?? all[0]
    ?? fallback;
}
