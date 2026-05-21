// LLM呼び出しの共通ユーティリティ（リトライ・堅牢なJSON抽出）

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelayMs = 700): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
    }
  }
  throw new Error('unreachable');
}

// GeminiグラウンディングのリダイレクトURL（vertexaisearch...）は一時リンクで
// 期限切れ後に404になる。実URLに解決し、解決できなければnullを返す（404の温床を避ける）。
export async function resolveGroundingUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!/vertexaisearch\.cloud\.google\.com|grounding-api-redirect/.test(url)) return url;
  // 1. HEADでLocationヘッダだけ取得（軽量）
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const loc = head.headers.get('location');
    if (loc && /^https?:\/\//.test(loc) && !loc.includes('vertexaisearch.cloud.google.com')) return loc;
  } catch { /* fall through */ }
  // 2. リダイレクトを辿って最終URLを取得
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (res.url && !res.url.includes('vertexaisearch.cloud.google.com')) return res.url;
  } catch { /* ignore */ }
  return null;
}

// LLMの自由文出力から最初のJSON（オブジェクト or 配列）を頑健に取り出す
export function extractJson<T = unknown>(text: string): T {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 最初の { または [ から対応する終端までを抽出
    const start = cleaned.search(/[{[]/);
    if (start === -1) throw new Error('JSONが見つかりません');
    const open = cleaned[start];
    const close = open === '{' ? '}' : ']';
    const end = cleaned.lastIndexOf(close);
    if (end <= start) throw new Error('JSONの終端が見つかりません');
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  }
}
