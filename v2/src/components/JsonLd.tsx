// 構造化データ(JSON-LD)を <script> で埋め込む。
// データはサーバ制御の固定値のみ（ユーザー入力を入れない）。children方式で描画するため
// dangerouslySetInnerHTML 不使用＝Reactが '<' をエスケープし </script> breakout も防ぐ（XSS安全）。
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json">{JSON.stringify(data)}</script>;
}
