/**
 * 環境変数の読み方を1か所に集める。
 *
 * ⚠ なぜ要るか: 環境変数には「未設定」と「空文字」の2通りがあり、`??` は**空文字を通す**。
 *   GitHub Actions は未設定の secret を `FOO: ${{ secrets.FOO }}` で渡すと**空文字**として入れるので、
 *   `process.env.FOO ?? 既定値` は既定値に落ちない。実際に踏んだ壊れ方:
 *
 *   - `Number(process.env.BATCH_CHUNK ?? 150)` → `Number('')` は **0**。
 *     `for (let i = 0; i < n; i += chunkSize)` が **無限ループ**になり、
 *     同じバッチジョブを Gemini Batch API に投げ続ける（第二条・コスト）。
 *     値がゴミ（`Number('abc')`＝NaN）だと逆に**ループが1周も回らず黙って0件**になる。
 *   - `process.env.SITE_URL ?? 既定URL` → 空文字が `new URL('')` に渡って投げ、
 *     受信者ごとの try/catch に飲まれて**全員分の送信が失敗しても 0/N件 と出るだけ**だった（判断ログ㉞）。
 */

/** 与えた中から最初の「空でない」値を返す（前後の空白は落とす）。全部空なら null。 */
export function firstNonEmpty(...values: (string | undefined | null)[]): string | null {
  for (const v of values) {
    const t = (v ?? '').trim();
    if (t) return t;
  }
  return null;
}
