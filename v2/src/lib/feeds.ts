// v4: ドメインからRSS/Atomフィードを自動発見する（検索の卒業エンジン）。
// 検索(有料Grounding)が見つけた高品質記事のドメインをフィード化し、
// 以後はそのフィードを無料で巡回する。daily_pipeline と遡及スクリプトで共有。
//
// 重要: フィード自体の「AI濃度」をゲートする。単発で1本だけAI記事を出したが
// フィードは非AIファイアホース(NYT/Business Insider等)を弾き、巡回トークンの浪費を防ぐ。

const FEED_LINK_RE = /<link\b[^>]*>/gi;
// homepageに<link rel=alternate>が無いサイト向けの定番パス
const COMMON_PATHS = ['/feed', '/rss.xml', '/atom.xml', '/feed.xml', '/index.xml', '/feed/', '/blog/feed/'];

// 短い英語キーワードは単語境界でマッチ（"ai"が again/domain/campaign 等に誤マッチするのを防ぐ）
const AI_WORD_RE = /\b(ai|a\.i\.|llm|llms|gpt|gpts|agi|rag|gpu|gpus|tpu|claude|gemini|openai|anthropic|chatgpt|llama|mistral|copilot|transformer|transformers|diffusion|neural|inference|agent|agents|agentic|multimodal|embedding|fine-?tuning|deepmind|deepseek|qwen|nvidia)\b/i;
// フレーズ/日本語は部分一致（語境界の概念が無い）
const AI_PHRASES = [
  'machine learning', 'deep learning', 'hugging face', 'large language', 'language model',
  '生成ai', '人工知能', '機械学習', '深層学習', '大規模言語', 'エージェント', '推論', '基盤モデル',
];
function titleIsAi(t: string): boolean {
  return AI_WORD_RE.test(t) || AI_PHRASES.some(p => t.includes(p));
}

async function fetchText(url: string, timeoutMs = 6000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

function looksLikeFeed(text: string): boolean {
  return /<rss[\s>]|<feed[\s>]|<item[\s>]|<entry[\s>]/i.test(text.slice(0, 4000));
}

// フィード内のタイトル群からAIキーワード一致率を測る。
// 先頭<title>はフィード名なので除外。{ density, hits } を返す。
function aiDensity(feedXml: string): { density: number; hits: number } {
  const titles = (feedXml.match(/<title[^>]*>([\s\S]*?)<\/title>/gi) ?? [])
    .map(t => t.replace(/<[^>]+>/g, '').toLowerCase());
  const items = titles.slice(1); // 先頭はチャンネル名
  if (items.length === 0) return { density: 0, hits: 0 };
  const hits = items.filter(titleIsAi).length;
  return { density: hits / items.length, hits };
}

// AI濃度ゲート: 最低2本のAIタイトル かつ 濃度15%以上（ファイアホースを除外）
function isAiFeed(body: string): boolean {
  if (!looksLikeFeed(body)) return false;
  const { density, hits } = aiDensity(body);
  return hits >= 2 && density >= 0.15;
}

// ドメインのAIフィードURLを返す。AI濃度が低い/見つからなければnull。
export async function discoverFeedUrl(domain: string): Promise<string | null> {
  const base = `https://${domain}`;

  // 1) homepageの <link rel="alternate" type="application/rss+xml|atom+xml"> を読む（最も確実）
  const html = await fetchText(base);
  if (html) {
    for (const tag of html.match(FEED_LINK_RE) ?? []) {
      if (!/alternate/i.test(tag) || !/(rss|atom)\+xml/i.test(tag)) continue;
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      try {
        const abs = new URL(href, base).toString();
        const body = await fetchText(abs);
        if (body && isAiFeed(body)) return abs;
      } catch { /* 不正なhref */ }
    }
  }

  // 2) 定番パスを総当たり（最初にAIフィードだったものを返す）
  for (const p of COMMON_PATHS) {
    const body = await fetchText(base + p);
    if (body && isAiFeed(body)) return base + p;
  }
  return null;
}

// ── v4: 本文ディープ抽出（無料・LLM不使用）──────────────────────────────
// <article>/<main>を優先し、ナビ・スクリプト等を除いた本文テキストを返す。
export function extractMainText(html: string): string {
  const scoped =
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    html;
  return scoped
    .replace(/<(script|style|nav|header|footer|aside|form|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// 記事URLから本文テキストを取得（HTML以外・抽出失敗時はnull）。maxCharsで上限。
export async function fetchArticleText(url: string, maxChars = 6000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    if (!/html/i.test(res.headers.get('content-type') ?? '')) return null; // PDF等はスキップ
    const text = extractMainText(await res.text());
    if (text.length < 200) return null; // JS依存ページ等で抽出失敗
    return text.slice(0, maxChars);
  } catch { return null; }
}
