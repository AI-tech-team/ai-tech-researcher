// 記事カテゴリの色。**装飾ではなく情報**（どの分野の記事かを一目で分ける）なので残すが、
// 値は CSS 変数を指す。テーマを明るい側に切り替えたとき、暗色前提の明るい水色や桃色が
// 紙の上に乗って読めなくなるのを防ぐため（変数の実体は globals.css の :root / [data-theme]）。
//
// 経緯: 同じ表が6ファイルにコピーされていた（DRY違反）。テーマ対応で6箇所を別々に直すと
// 必ず1つ取り残すので、ここに集約する。
//
// ⚠ OG画像（src/app/articles/[id]/opengraph-image.tsx）だけはここを使えない。
//    satori はブラウザではないので CSS 変数を解決できず、リテラルの色が要る。
export const CATEGORY_COLORS: Record<string, string> = {
  'LLM推論': 'var(--cat-llm)',
  'エージェント': 'var(--cat-agent)',
  'ツール/フレームワーク': 'var(--cat-tool)',
  'ハードウェア': 'var(--cat-hw)',
  'ビジネス応用': 'var(--cat-biz)',
  '研究/論文': 'var(--cat-paper)',
  'その他': 'var(--cat-other)',
};

/** カテゴリ色。未知のカテゴリは「その他」の色に倒す。 */
export function categoryColor(category: string | null | undefined): string {
  return CATEGORY_COLORS[category ?? ''] ?? 'var(--cat-other)';
}
