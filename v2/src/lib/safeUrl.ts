// 外部リンク用URLの安全化。http(s)スキームのみ許可し、javascript:/data:/vbscript:等の
// 危険スキームやGeminiグラウンディングの期限切れリダイレクトURLを弾く。
// フィード/グラウンディング由来のurlを <a href> に描画する全箇所で必ず通す（stored XSS対策）。
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url.trim())) return null;
  if (url.includes('vertexaisearch.cloud.google.com')) return null;
  return url;
}

// SSRF対策: サーバ側で外部URLをfetchする前のガード。
// http(s)のみ許可し、内部/プライベート/ループバック/クラウドメタデータ宛のホストを弾く。
// 注: ホスト名/IPリテラルの検査であり、公開ドメインが内部IPに解決するDNSリバインディングまでは
//     防げない（完全防御には解決後IPのピン留めが必要）。obviousなSSRFベクタを塞ぐ多層防御。
function isBlockedFetchHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase(); // IPv6の角括弧除去
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === 'metadata.google.internal') return true;
  // IPv4リテラル
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true;          // this-net / private / loopback
    if (a === 169 && b === 254) return true;                    // link-local（クラウドメタデータ 169.254.169.254 含む）
    if (a === 172 && b >= 16 && b <= 31) return true;           // private
    if (a === 192 && b === 168) return true;                    // private
    if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
  }
  // IPv6 ループバック/リンクローカル/ユニークローカル
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  return false;
}

export function isSafeFetchUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return !isBlockedFetchHost(u.hostname);
}
