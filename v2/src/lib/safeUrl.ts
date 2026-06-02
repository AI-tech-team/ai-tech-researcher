// 外部リンク用URLの安全化。http(s)スキームのみ許可し、javascript:/data:/vbscript:等の
// 危険スキームやGeminiグラウンディングの期限切れリダイレクトURLを弾く。
// フィード/グラウンディング由来のurlを <a href> に描画する全箇所で必ず通す（stored XSS対策）。
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url.trim())) return null;
  if (url.includes('vertexaisearch.cloud.google.com')) return null;
  return url;
}
