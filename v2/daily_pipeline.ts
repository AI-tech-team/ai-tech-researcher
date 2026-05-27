import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { google } from '@ai-sdk/google';
import { generateText, generateObject, embedMany, tool, stepCountIs } from 'ai';
import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { eq, sql, desc, asc, count, and, gte, lt, isNull, inArray } from 'drizzle-orm';
import { config } from 'dotenv';
import * as nodemailer from 'nodemailer';
import * as schema from './src/db/schema';
import { resolveGroundingUrl, extractJson } from './src/lib/llm';
import { discoverFeedUrl, fetchArticleText } from './src/lib/feeds';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

config({ path: '.env.local' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client, { schema });

const TECHDRIP_CAT_MAP: Record<string, string | null> = {
  'AI': 'エージェント', 'LLM': 'LLM推論', '開発手法': 'ツール/フレームワーク',
  'OSS': 'ツール/フレームワーク', 'セキュリティ': 'ビジネス応用', 'クラウド': 'ハードウェア',
  '研究': '研究/論文', 'キャリア': 'ビジネス応用', '業界': 'ビジネス応用',
  'ガジェット': 'ハードウェア', 'エンタメ': null,
};

function parseTechDripScore(scoreStr: string): number {
  const num = parseInt(scoreStr.replace(/[^\d]/g, ''), 10);
  if (isNaN(num)) return 5;
  if (num >= 400) return 10; if (num >= 200) return 9; if (num >= 100) return 8;
  if (num >= 50) return 7;   if (num >= 20) return 6;  return 5;
}

const GROUNDING_SKIP_DOMAINS = ['google.', 'youtube.', 'wikipedia.', 't.co', 'twitter.', 'x.com'];

const KW_STOPWORDS = new Set([
  'AI', 'LLM', 'ML', 'AGI', 'GPT', 'API',
  '人工知能', '機械学習', '深層学習', 'ディープラーニング',
  'モデル', '研究', '技術', 'データ', 'アルゴリズム', 'システム',
  '学習', '最適化', 'ツール', 'フレームワーク', 'ライブラリ',
]);

const DOMAIN_SKIP = new Set([
  'google.com', 'youtube.com', 'wikipedia.org', 't.co', 'twitter.com', 'x.com',
  'instagram.com', 'facebook.com', 'linkedin.com', 'techdrip.net', 'github.com',
  // v4: ファイアホース/集約系（個別記事の質に対しフィードが広すぎ・既に別経路で巡回）
  'medium.com', 'reddit.com', 'substack.com', 'arxiv.org', 'huggingface.co',
  'vertexaisearch.cloud.google.com',
]);

const HN_AI_KEYWORDS = [
  'ai', 'llm', 'gpt', 'claude', 'gemini', 'openai', 'anthropic', 'chatgpt',
  'machine learning', 'neural', 'deep learning', 'transformer', 'diffusion',
  'agi', 'alignment', 'mistral', 'llama', 'copilot', 'hugging face',
];

// ── 構造化出力スキーマ ────────────────────────────────────────────────
const CATS = ['LLM推論', 'エージェント', 'ツール/フレームワーク', 'ハードウェア', 'ビジネス応用', '研究/論文', 'その他'] as const;

// v3知識グラフ: claims/benchmarks/relations を1回の構造化出力でまとめて抽出
const RELATION_TYPES = ['outperforms', 'competes_with', 'builds_on', 'acquired_by', 'cites', 'supersedes'] as const;

// 知識抽出ロジックのバージョン。抽出プロンプト/フィルタ/正規化を変えたら +1 する。
// collected_data.extraction_version がこの値未満の記事を batch_submit が再抽出対象にする（遡及適用）。
// v1: 文脈フィルタ（推測・伝聞・主観・相対表現の除外）導入。
const EXTRACTION_VERSION = 1;

// Batch API用の公式SDKクライアント（非同期バッチは @ai-sdk/google 非対応のため）
const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
const KnowledgeSchema = z.object({
  claims: z.array(z.object({
    subject: z.string().max(80),
    predicate: z.string().max(80),
    value: z.string().max(150),
    confidence: z.enum(['high', 'medium', 'low']),
  })).max(3),
  benchmarks: z.array(z.object({
    entity: z.string().max(80),     // モデル/システム名
    benchmark: z.string().max(80),  // ベンチマーク名（MMLU, GSM8K, SWE-bench 等）
    score: z.number(),
    unit: z.string().max(20).nullable(), // '%', 'points', 'Elo' 等。不明はnull
    confidence: z.enum(['high', 'medium', 'low']),
  })).max(5),
  relations: z.array(z.object({
    subject: z.string().max(80),
    relation: z.enum(RELATION_TYPES),
    object: z.string().max(80),
    confidence: z.enum(['high', 'medium', 'low']),
  })).max(5),
});

// summaryは超過しやすく max(300) だとスキーマ不一致で評価ごと失敗→フィード丸ごと0件になる。
// 余裕を持たせ(600)、挿入時に切り詰める。
const ArticleEvalSchema = z.object({
  items: z.array(z.object({
    importance: z.number().int().min(0).max(10),
    category: z.enum(CATS),
    summary: z.string().max(600),
  })),
});

const HnEvalSchema = z.object({
  items: z.array(z.object({
    summary: z.string().max(600),
    category: z.enum(CATS),
  })),
});

const KeywordsSchema = z.object({
  keywords: z.array(z.string().min(2).max(60)),
});

// ── 指数バックオフリトライ ─────────────────────────────────────────────
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelayMs = 800): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (attempt === maxRetries - 1) throw e;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`  Geminiリトライ ${attempt + 1}/${maxRetries - 1} (${delay}ms後): ${(e.message ?? '').slice(0, 60)}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

// ── ソース権威性ボーナス ────────────────────────────────────────────
const AUTHORITY_SOURCE_VALUES = new Set([
  'https://huggingface.co/blog/feed.xml',
  'https://deepmind.google/blog/rss.xml',
  'https://openai.com/blog/rss.xml',
  'https://ai.meta.com/blog/feed/',
  'https://www.anthropic.com/rss.xml',
  'https://blogs.microsoft.com/ai/feed/',
  'https://research.google/blog/rss/',
  'https://mistral.ai/news/rss/',
]);

function getAuthorityBonus(source: typeof schema.sources.$inferSelect): number {
  if (AUTHORITY_SOURCE_VALUES.has(source.value)) return 1;
  if (source.type === 'arxiv' || source.type === 'pwc') return 1;
  return 0;
}

// ── タイトル類似度重複排除ユーティリティ ─────────────────────────────────
let _recentTitleCache: string[] | null = null;

async function getRecentTitleCache(): Promise<string[]> {
  if (_recentTitleCache !== null) return _recentTitleCache;
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.select({ title: schema.collectedData.title })
    .from(schema.collectedData)
    .where(gte(schema.collectedData.createdAt, cutoff));
  _recentTitleCache = rows.map(r => r.title ?? '').filter(Boolean);
  return _recentTitleCache;
}

function jaccardSim(a: string, b: string): number {
  const tokenize = (s: string): Set<string> => {
    const tokens = new Set<string>();
    // ASCII単語（3文字以上）
    for (const w of (s.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])) tokens.add(w);
    // CJK文字のバイグラム（日本語/中国語対応）
    const cjk = s.replace(/[^　-鿿＀-￯]/g, '');
    for (let i = 0; i < cjk.length - 1; i++) tokens.add(cjk.slice(i, i + 2));
    return tokens;
  };
  const wa = tokenize(a);
  const wb = tokenize(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  wa.forEach(w => { if (wb.has(w)) shared++; });
  return shared / (wa.size + wb.size - shared);
}

function isNearDuplicate(title: string, cache: string[], threshold = 0.75): boolean {
  return cache.some(existing => jaccardSim(title, existing) >= threshold);
}

// LLM評価の前にDB既収集URLを除外する（同一記事の再評価＝トークン浪費を防ぐ）。
// 全件が既収集なら呼び出し元はLLMをスキップできる。
async function filterUnseenUrls<T>(items: T[], getUrl: (i: T) => string | null | undefined): Promise<T[]> {
  if (items.length === 0) return items;
  const urls = items.map(getUrl).filter((u): u is string => !!u);
  if (urls.length === 0) return items;
  const existing = await db.select({ url: schema.collectedData.url })
    .from(schema.collectedData)
    .where(inArray(schema.collectedData.url, urls));
  const seen = new Set(existing.map(r => r.url));
  return items.filter(i => { const u = getUrl(i); return !u || !seen.has(u); });
}

// ── RSS収集（RSS/Atom両対応）─────────────────────────────────────────
async function collectFromRSS(source: typeof schema.sources.$inferSelect, sevenDaysAgo: string): Promise<number> {
  const res = await fetch(source.value, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

  // Atom (<entry>) と RSS (<item>) の両フォーマットに対応
  const isAtom = /<entry[\s>]/i.test(xml);
  const itemTag = isAtom ? 'entry' : 'item';
  const items: Array<{ title: string; link: string; description: string; pubDate: string }> = [];
  const itemRegex = new RegExp(`<${itemTag}>[\\s\\S]*?<\\/${itemTag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const chunk = m[0];
    const get = (tag: string) =>
      (chunk.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'))?.[1] ?? '').trim();
    const title = get('title');
    // Atom は <link href="url"/> 形式を使う
    const link = isAtom
      ? (chunk.match(/<link[^>]+href="([^"]+)"/i)?.[1] ?? get('link'))
      : get('link');
    const description = isAtom
      ? (get('summary') || get('content')).replace(/<[^>]*>/g, '').slice(0, 500)
      : get('description').replace(/<[^>]*>/g, '').slice(0, 500);
    const pubDate = isAtom
      ? (get('updated') || get('published'))
      : get('pubDate');
    if (title && link) items.push({ title, link, description, pubDate });
  }

  const sevenDaysAgoMs = new Date(sevenDaysAgo).getTime();
  const recent = items.filter(item => {
    if (!item.pubDate) return true;
    const d = new Date(item.pubDate).getTime();
    return isNaN(d) || d >= sevenDaysAgoMs;
  }).slice(0, 20);

  if (recent.length === 0) return 0;

  const fresh = await filterUnseenUrls(recent, it => it.link);
  if (fresh.length === 0) return 0;

  const batchText = fresh.map((item, i) => `[${i}] ${item.title}\n${item.description}`).join('\n\n');
  const { object } = await withRetry(() => generateObject({
    model: google('gemini-2.5-flash-lite'),
    schema: ArticleEvalSchema,
    prompt: `以下の記事をAI技術の観点で評価してください。AI技術と無関係な記事はimportance: 0にしてください。各記事のimportance(0-10)、category、日本語summary(150文字)を生成してください。必ず${fresh.length}件分のitemsを返してください。\n\n${batchText}`,
  }));
  const evaluations = object.items;
  if (evaluations.length !== fresh.length) {
    console.warn(`  [RSS] 評価数不一致: LLM=${evaluations.length}件 / 取得=${fresh.length}件`);
  }
  const authorityBonus = getAuthorityBonus(source);

  const titleCache = await getRecentTitleCache();
  let inserted = 0;
  for (let i = 0; i < fresh.length; i++) {
    const item = fresh[i];
    const ev = evaluations[i];
    if (!ev || ev.importance < 4) continue;
    if (isNearDuplicate(item.title, titleCache)) continue;
    const pubDate = item.pubDate ? new Date(item.pubDate) : null;
    const r = await db.insert(schema.collectedData).values({
      sourceId: source.id,
      title: item.title,
      url: item.link,
      summary: (ev.summary ?? '').slice(0, 300),
      category: ev.category ?? 'その他',
      importanceScore: Math.min(10, ev.importance + authorityBonus),
      publishedAt: pubDate && !isNaN(pubDate.getTime()) ? pubDate.toISOString() : new Date().toISOString(),
    }).onConflictDoNothing();
    if (r.rowsAffected > 0) { inserted++; _recentTitleCache?.push(item.title); }
  }
  return inserted;
}

// ── Hacker News収集（Firebase API）────────────────────────────────────
async function collectFromHN(source: typeof schema.sources.$inferSelect): Promise<number> {
  const topRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
    signal: AbortSignal.timeout(10000),
  });
  const topIds: number[] = await topRes.json();

  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const candidates: Array<{ title: string; url: string; score: number; time: number }> = [];

  for (const id of topIds.slice(0, 150)) {
    if (candidates.length >= 5) break;
    try {
      const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        signal: AbortSignal.timeout(5000),
      });
      const item = await itemRes.json();
      if (!item?.url || !item.title) continue;
      if ((item.score ?? 0) < 100) continue;
      if (item.time && item.time * 1000 < sevenDaysAgoMs) continue;
      const titleLower = (item.title as string).toLowerCase();
      if (HN_AI_KEYWORDS.some(kw => titleLower.includes(kw))) {
        candidates.push({ title: item.title, url: item.url, score: item.score, time: item.time });
      }
    } catch { /* ignore */ }
  }

  if (candidates.length === 0) return 0;

  const fresh = await filterUnseenUrls(candidates, it => it.url);
  if (fresh.length === 0) return 0;

  const batchText = fresh.map((item, i) => `[${i}] [HN Score:${item.score}] ${item.title}`).join('\n');
  const { object: hnObject } = await withRetry(() => generateObject({
    model: google('gemini-2.5-flash-lite'),
    schema: HnEvalSchema,
    prompt: `以下のHacker NewsのAI/ML関連記事の専門的な日本語summary（200文字）とcategoryを生成してください。\n\n${batchText}`,
  }));
  const evaluations = hnObject.items;

  const titleCache = await getRecentTitleCache();
  let inserted = 0;
  for (let i = 0; i < fresh.length; i++) {
    const item = fresh[i];
    const ev = evaluations[i];
    if (!ev) continue;
    if (isNearDuplicate(item.title, titleCache)) continue;
    const importanceScore = item.score >= 500 ? 10 : item.score >= 200 ? 9 : item.score >= 100 ? 8 : 7;
    const r = await db.insert(schema.collectedData).values({
      sourceId: source.id,
      title: item.title,
      url: item.url,
      summary: ev.summary,
      category: ev.category ?? 'その他',
      importanceScore,
      tags: JSON.stringify(['hacker-news', `hn-score:${item.score}`]),
      publishedAt: new Date(item.time * 1000).toISOString(),
    }).onConflictDoNothing();
    if (r.rowsAffected > 0) { inserted++; _recentTitleCache?.push(item.title); }
  }
  return inserted;
}

// ── ArXiv論文収集（cs.AI / cs.LG / cs.CL）────────────────────────────
async function collectFromArXiv(source: typeof schema.sources.$inferSelect): Promise<number> {
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const url = 'https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL&sortBy=submittedDate&sortOrder=descending&max_results=30';

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`ArXiv HTTP ${res.status}`);
  const xml = await res.text();

  const entries: Array<{ title: string; url: string; summary: string; published: string }> = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(xml)) !== null) {
    const chunk = m[1];
    const get = (tag: string) =>
      (chunk.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'))?.[1] ?? '').trim();
    const title = get('title').replace(/\s+/g, ' ');
    const link = chunk.match(/<link[^>]+href="([^"]+)"[^>]*rel="alternate"/)?.[1]
               ?? chunk.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/)?.[1]
               ?? '';
    const summary = get('summary').replace(/\s+/g, ' ').slice(0, 500);
    const published = get('published');
    if (title && link) entries.push({ title, url: link, summary, published });
  }

  const recent = entries.filter(e =>
    e.published && new Date(e.published).getTime() >= sevenDaysAgoMs
  ).slice(0, 10);

  if (recent.length === 0) return 0;

  const fresh = await filterUnseenUrls(recent, it => it.url);
  if (fresh.length === 0) return 0;

  const batchText = fresh.map((e, i) => `[${i}] ${e.title}\n${e.summary}`).join('\n\n');
  const { object: arxivObject } = await withRetry(() => generateObject({
    model: google('gemini-2.5-flash-lite'),
    schema: ArticleEvalSchema,
    prompt: `以下のArXiv論文（cs.AI/cs.LG/cs.CL）の技術的重要度(0-10)、category、日本語summary(150文字)を評価してください。必ず${fresh.length}件分のitemsを返してください。\n\n${batchText}`,
  }));
  const evaluations = arxivObject.items;
  if (evaluations.length !== fresh.length) {
    console.warn(`  [ArXiv] 評価数不一致: LLM=${evaluations.length}件 / 取得=${fresh.length}件`);
  }
  const authorityBonus = getAuthorityBonus(source);

  const titleCache = await getRecentTitleCache();
  let inserted = 0;
  for (let i = 0; i < fresh.length; i++) {
    const item = fresh[i];
    const ev = evaluations[i];
    if (!ev || ev.importance < 5) continue;
    if (isNearDuplicate(item.title, titleCache)) continue;
    const r = await db.insert(schema.collectedData).values({
      sourceId: source.id,
      title: item.title,
      url: item.url,
      summary: ev.summary,
      category: ev.category ?? '研究/論文',
      importanceScore: Math.min(10, ev.importance + authorityBonus),
      tags: JSON.stringify(['arxiv', ev.category ?? '研究/論文']),
      publishedAt: item.published ? new Date(item.published).toISOString() : new Date().toISOString(),
    }).onConflictDoNothing();
    if (r.rowsAffected > 0) { inserted++; _recentTitleCache?.push(item.title); }
  }
  return inserted;
}

// ── GitHub Trending AI収集（GitHub Search API）────────────────────────
async function collectFromGitHubTrending(source: typeof schema.sources.$inferSelect): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  // OR + created: の組合せはGitHub APIが422を返すため、in:topics + pushed: 形式に修正
  const url = `https://api.github.com/search/repositories?q=llm+OR+ai-agent+OR+machine-learning+in:topics+stars:>200+pushed:>${sevenDaysAgo}&sort=stars&order=desc&per_page=15`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'AIResearcher/1.0', 'Accept': 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const json = await res.json();
  const items: any[] = json.items ?? [];
  if (items.length === 0) return 0;

  const allCandidates = items.slice(0, 10);
  const candidates = await filterUnseenUrls(allCandidates, (r: any) => r.html_url);
  if (candidates.length === 0) return 0;

  const batchText = candidates.map((r: any, i: number) =>
    `[${i}] [⭐${r.stargazers_count}] ${r.full_name}\n${r.description ?? ''}\nTopics: ${(r.topics ?? []).slice(0, 5).join(', ')}`
  ).join('\n\n');

  const { object: ghObject } = await withRetry(() => generateObject({
    model: google('gemini-2.5-flash-lite'),
    schema: ArticleEvalSchema,
    prompt: `以下のGitHubトレンドリポジトリ（AI/ML分野）の技術的重要度(0-10)、category、日本語summary(150文字)を評価してください。必ず${candidates.length}件分のitemsを返してください。\n\n${batchText}`,
  }));
  const evaluations = ghObject.items;
  if (evaluations.length !== candidates.length) {
    console.warn(`  [GitHub] 評価数不一致: LLM=${evaluations.length}件 / 取得=${candidates.length}件`);
  }

  const titleCache = await getRecentTitleCache();
  let inserted = 0;
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const ev = evaluations[i];
    if (!ev || ev.importance < 5) continue;
    const ghTitle = `[GitHub] ${item.full_name}`;
    if (isNearDuplicate(ghTitle, titleCache)) continue;
    const r = await db.insert(schema.collectedData).values({
      sourceId: source.id,
      title: ghTitle,
      url: item.html_url,
      summary: ev.summary,
      category: ev.category ?? 'ツール/フレームワーク',
      importanceScore: ev.importance,
      tags: JSON.stringify(['github-trending', `⭐${item.stargazers_count}`]),
      publishedAt: item.created_at ?? new Date().toISOString(),
    }).onConflictDoNothing();
    if (r.rowsAffected > 0) { inserted++; _recentTitleCache?.push(ghTitle); }
  }
  return inserted;
}

// ── Papers with Code収集（コード実装付き論文）────────────────────────
async function collectFromPapersWithCode(source: typeof schema.sources.$inferSelect): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const url = 'https://paperswithcode.com/api/v1/papers/?format=json&ordering=-date&has_code=true&page=1&items_per_page=30';

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`PwC API error: ${res.status}`);
  const json = await res.json();
  const results: any[] = json.results ?? [];

  const recentAll = results.filter(p => p.published && p.published >= sevenDaysAgo).slice(0, 10);
  if (recentAll.length === 0) return 0;

  const pwcUrl = (p: any) => p.paper_url ?? (p.arxiv_id ? `https://arxiv.org/abs/${p.arxiv_id}` : null);
  const fresh = await filterUnseenUrls(recentAll, pwcUrl);
  if (fresh.length === 0) return 0;

  const batchText = fresh.map((p, i) =>
    `[${i}] ${p.title}\n${p.abstract?.slice(0, 400) ?? ''}\nTasks: ${(p.tasks ?? []).slice(0, 3).map((t: any) => t.name).join(', ')}`
  ).join('\n\n');

  const { object: pwcObject } = await withRetry(() => generateObject({
    model: google('gemini-2.5-flash-lite'),
    schema: ArticleEvalSchema,
    prompt: `以下のPapers with Codeの論文（コード実装あり）の技術的重要度(0-10)、category、日本語summary(150文字)を評価してください。必ず${fresh.length}件分のitemsを返してください。\n\n${batchText}`,
  }));
  const evaluations = pwcObject.items;
  if (evaluations.length !== fresh.length) {
    console.warn(`  [PwC] 評価数不一致: LLM=${evaluations.length}件 / 取得=${fresh.length}件`);
  }
  const authorityBonus = getAuthorityBonus(source);

  const titleCache = await getRecentTitleCache();
  let inserted = 0;
  for (let i = 0; i < fresh.length; i++) {
    const item = fresh[i];
    const ev = evaluations[i];
    if (!ev || ev.importance < 5) continue;
    if (isNearDuplicate(item.title, titleCache)) continue;
    const paperUrl = item.paper_url ?? (item.arxiv_id ? `https://arxiv.org/abs/${item.arxiv_id}` : null);
    if (!paperUrl) continue;
    const r = await db.insert(schema.collectedData).values({
      sourceId: source.id,
      title: item.title,
      url: paperUrl,
      summary: ev.summary,
      category: ev.category ?? '研究/論文',
      importanceScore: Math.min(10, ev.importance + authorityBonus),
      tags: JSON.stringify(['papers-with-code', ...(item.tasks ?? []).slice(0, 2).map((t: any) => t.name as string)]),
      publishedAt: item.published ? new Date(item.published).toISOString() : new Date().toISOString(),
    }).onConflictDoNothing();
    if (r.rowsAffected > 0) { inserted++; _recentTitleCache?.push(item.title); }
  }
  return inserted;
}

async function collectData(rounds = 10): Promise<{ collected: number; failed: number }> {
  console.log(`[Collect] ${rounds}ラウンド開始`);
  let collected = 0;
  let failed = 0;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  // URL型ソース（techdrip.net等）を先に処理
  const urlSources = await db.select().from(schema.sources)
    .where(eq(schema.sources.type, 'url') as any)
    .limit(10);

  for (const target of urlSources) {
    if (target.status !== 'active') continue;
    try {
      const res = await fetch(target.value, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      const html = await res.text();
      const match = html.match(/const ITEMS_BY_DATE = (\{[\s\S]*?\});\s*\n/);
      if (!match) { console.warn(`  スキップ (${target.value}): ITEMS_BY_DATE なし`); continue; }

      const itemsByDate: Record<string, any[]> = JSON.parse(match[1]);
      const d = new Date(today);
      const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      const items: any[] = itemsByDate[dateKey] ?? [];

      let batchInserted = 0;
      let totalImportanceBoost = 0;
      const deepFetchUrls: string[] = [];

      for (const item of items) {
        if (item.src === 'gareso') continue;
        const category = TECHDRIP_CAT_MAP[item.tag ?? ''];
        if (category === null) continue;
        const rawScore = parseInt((item.score ?? '').replace(/[^\d]/g, ''), 10);
        if (isNaN(rawScore) || rawScore < 20) continue;
        const summary = [item.summary, item.comment_summary].filter(Boolean).join('\n\n').slice(0, 600) || item.title;
        const tags = JSON.stringify([item.src, item.domain].filter(Boolean).slice(0, 3));
        const importanceScore = parseTechDripScore(item.score ?? '');
        const r = await db.insert(schema.collectedData).values({
          sourceId: target.id, title: item.title, url: item.url, summary,
          category: category ?? 'その他', importanceScore,
          tags, publishedAt: today + 'T00:00:00.000Z',
        }).onConflictDoNothing();
        if (r.rowsAffected > 0) {
          batchInserted++;
          collected++;
          if (importanceScore >= 7) totalImportanceBoost += (importanceScore - 6) * 0.5;
          if (rawScore >= 100 && item.url) deepFetchUrls.push(item.url);
        }
      }

      if (totalImportanceBoost > 0) {
        const boost = Math.min(3.0, totalImportanceBoost);
        await db.update(schema.sources)
          .set({ score: sql`COALESCE(${schema.sources.score}, 0.0) + ${boost}` })
          .where(eq(schema.sources.id, target.id));
      }

      for (const url of deepFetchUrls) {
        const fullText = await fetchArticleText(url);
        if (!fullText) continue;
        await db.update(schema.collectedData)
          .set({ rawContent: fullText })
          .where(eq(schema.collectedData.url, url));
        console.log(`    [深掘り] ${url.slice(0, 60)}`);
      }

      await db.update(schema.sources).set({ lastHitAt: new Date().toISOString() }).where(eq(schema.sources.id, target.id));
      console.log(`  [${target.value}] ${dateKey}: ${batchInserted}件追加`);
    } catch (e: any) {
      console.error(`  URL収集失敗 (${target.value}): ${e.message}`);
      failed++;
    }
  }

  // RSS型ソース（TechCrunch AI等）
  const rssSources = await db.select().from(schema.sources)
    .where(and(eq(schema.sources.type, 'rss' as any), eq(schema.sources.status, 'active')));
  for (const target of rssSources) {
    try {
      const inserted = await collectFromRSS(target, sevenDaysAgo);
      collected += inserted;
      await db.update(schema.sources).set({ lastHitAt: new Date().toISOString() }).where(eq(schema.sources.id, target.id));
      console.log(`  [RSS] ${target.value.slice(0, 50)}: ${inserted}件追加`);
    } catch (e: any) {
      console.error(`  RSS収集失敗: ${e.message}`);
      failed++;
    }
  }

  // HN型ソース（Hacker News）
  const hnSources = await db.select().from(schema.sources)
    .where(and(eq(schema.sources.type, 'hn' as any), eq(schema.sources.status, 'active')));
  for (const target of hnSources) {
    try {
      const inserted = await collectFromHN(target);
      collected += inserted;
      await db.update(schema.sources).set({ lastHitAt: new Date().toISOString() }).where(eq(schema.sources.id, target.id));
      console.log(`  [HN] ${inserted}件追加`);
    } catch (e: any) {
      console.error(`  HN収集失敗: ${e.message}`);
      failed++;
    }
  }

  // ArXiv型ソース
  const arxivSources = await db.select().from(schema.sources)
    .where(and(eq(schema.sources.type, 'arxiv' as any), eq(schema.sources.status, 'active')));
  for (const target of arxivSources) {
    try {
      const inserted = await collectFromArXiv(target);
      collected += inserted;
      await db.update(schema.sources).set({ lastHitAt: new Date().toISOString() }).where(eq(schema.sources.id, target.id));
      console.log(`  [ArXiv] ${inserted}件追加`);
    } catch (e: any) {
      console.error(`  ArXiv収集失敗: ${e.message}`);
      failed++;
    }
  }

  // GitHub Trending型ソース
  const githubSources = await db.select().from(schema.sources)
    .where(and(eq(schema.sources.type, 'github-trending' as any), eq(schema.sources.status, 'active')));
  for (const target of githubSources) {
    try {
      const inserted = await collectFromGitHubTrending(target);
      collected += inserted;
      await db.update(schema.sources).set({ lastHitAt: new Date().toISOString() }).where(eq(schema.sources.id, target.id));
      console.log(`  [GitHub Trending] ${inserted}件追加`);
    } catch (e: any) {
      console.error(`  GitHub Trending収集失敗: ${e.message}`);
      failed++;
    }
  }

  // Papers with Code型ソース
  const pwcSources = await db.select().from(schema.sources)
    .where(and(eq(schema.sources.type, 'pwc' as any), eq(schema.sources.status, 'active')));
  for (const target of pwcSources) {
    try {
      const inserted = await collectFromPapersWithCode(target);
      collected += inserted;
      await db.update(schema.sources).set({ lastHitAt: new Date().toISOString() }).where(eq(schema.sources.id, target.id));
      console.log(`  [PapersWithCode] ${inserted}件追加`);
    } catch (e: any) {
      console.error(`  PapersWithCode収集失敗: ${e.message}`);
      failed++;
    }
  }

  // キーワード型ソース（同一ソースを重複選択しない）
  const processedSourceIds = new Set<number>();
  for (let i = 0; i < rounds; i++) {
    const sourceList = await db.select().from(schema.sources)
      .where(and(
        eq(schema.sources.status, 'active'),
        sql`${schema.sources.type} IN ('url', 'keyword')`,
        processedSourceIds.size > 0
          ? sql`${schema.sources.id} NOT IN (${sql.join(Array.from(processedSourceIds).map(id => sql`${id}`), sql`, `)})`
          : undefined,
      ))
      .orderBy(sql`RANDOM() * (1 + COALESCE(${schema.sources.score}, 0)) DESC`)
      .limit(1);

    if (sourceList.length === 0) break;
    const target = sourceList[0];
    processedSourceIds.add(target.id);
    if (target.type === 'url') continue; // 既に処理済み

    try {
      const result = await withRetry(() => generateText({
        model: google('gemini-2.5-flash-lite'),
        tools: { google_search: google.tools.googleSearch({}) },
        system: `あなたはAI技術情報収集エンジンです。
与えられたキーワードでGoogle検索を行い、${sevenDaysAgo}〜${today} の期間に公開されたAI技術記事を1つ見つけてください。

【必須制約】
- 検索クエリに "after:${sevenDaysAgo}" を含めること
- 公開日が ${sevenDaysAgo} より古い記事は絶対に使用しない
- URLは検索結果に実在するURLのみ使用する（推測・生成禁止）
- 公開日が不明な場合は別の記事を探す

以下のJSONフォーマットのみを出力してください：
{"title": "記事タイトル", "url": "実際の記事URL", "publishedAt": "YYYY-MM-DD", "summary": "200文字程度の専門的な要約", "category": "LLM推論|エージェント|ツール/フレームワーク|ハードウェア|ビジネス応用|研究/論文|その他 のいずれか1つ", "importance": 8, "tags": ["tag1", "tag2"]}
importanceは1〜10でAI技術的重要度を評価。tagsは3〜5個の短いキーワード。`,
        prompt: `対象キーワード: ${target.value}\n検索対象期間: ${sevenDaysAgo}〜${today}`,
      }));

      const parsedData = extractJson<any>(result.text);

      const googleMeta = (result.providerMetadata?.google ?? (result as any).experimental_providerMetadata?.google) as any;
      const groundingChunks: any[] = googleMeta?.groundingMetadata?.groundingChunks ?? [];
      const groundingUrl = groundingChunks
        .map((c: any) => c.web?.uri as string | undefined)
        .filter((uri): uri is string => !!uri)
        .find(uri => !GROUNDING_SKIP_DOMAINS.some(d => uri.includes(d)));
      // グラウンディングのリダイレクトURLは実URLに解決（404防止）
      if (groundingUrl) {
        const resolved = await resolveGroundingUrl(groundingUrl);
        if (resolved) parsedData.url = resolved;
      }
      // 解決できないリダイレクトURLが残っていればスキップ
      if (parsedData.url && /vertexaisearch\.cloud\.google\.com|grounding-api-redirect/.test(parsedData.url)) {
        console.warn(`  スキップ (リダイレクトURL未解決): ${target.value}`);
        continue;
      }

      // URL検証
      if (!parsedData.url || !parsedData.title) {
        console.warn(`  スキップ (title/URL欠落): ${target.value}`);
        continue;
      }
      try { new URL(parsedData.url); } catch {
        console.warn(`  スキップ (無効URL "${String(parsedData.url).slice(0, 60)}"): ${target.value}`);
        continue;
      }

      if (parsedData.publishedAt) {
        const pubDate = new Date(parsedData.publishedAt);
        const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        if (pubDate < cutoff) {
          console.warn(`  スキップ (古い記事 ${parsedData.publishedAt}): ${target.value}`);
          continue;
        }
      }

      const tagsJson = Array.isArray(parsedData.tags) && parsedData.tags.length > 0
        ? JSON.stringify(parsedData.tags.slice(0, 5).map((t: any) => String(t).trim())) : null;

      const insertResult = await db.insert(schema.collectedData).values({
        sourceId: target.id, title: parsedData.title, url: parsedData.url,
        summary: parsedData.summary,
        category: (CATS as readonly string[]).includes(parsedData.category) ? parsedData.category : null,
        importanceScore: Math.min(10, Math.max(1, Math.round(Number(parsedData.importance ?? 5)))),
        tags: tagsJson,
        rawContent: result.text,
        publishedAt: parsedData.publishedAt ? new Date(parsedData.publishedAt).toISOString() : today + 'T00:00:00.000Z',
      }).onConflictDoNothing();

      if (insertResult.rowsAffected > 0) {
        const importance = parsedData.importance ?? 5;
        if (importance >= 7) {
          const boost = Math.min(2.0, (importance - 6) * 0.5);
          await db.update(schema.sources)
            .set({ score: sql`COALESCE(${schema.sources.score}, 0.0) + ${boost}` })
            .where(eq(schema.sources.id, target.id));
        }
      }

      await db.update(schema.sources).set({ lastHitAt: new Date().toISOString() }).where(eq(schema.sources.id, target.id));
      collected++;
      console.log(`  収集: [${parsedData.category ?? '未分類'}] ${parsedData.title} (${parsedData.publishedAt ?? '日付不明'})`);
    } catch (e: any) {
      console.error(`  失敗 (${target.value}): ${e.message}`);
      failed++;
    }
  }

  console.log(`[Collect] ${collected}件完了, ${failed}件失敗`);
  return { collected, failed };
}

async function generateReport(): Promise<string | null> {
  console.log('[Report] レポート生成開始');

  // データがあるか先にチェック
  const since2d = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const check = await db.select({ c: count() }).from(schema.collectedData)
    .where(gte(schema.collectedData.createdAt, since2d));
  if (Number(check[0].c) === 0) { console.log('[Report] データなし、スキップ'); return null; }

  const todayJST = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });
  const reportDateJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const { askKnowledgeAI } = await import('./src/lib/knowledge-ai');
  const text = await withRetry(() => askKnowledgeAI(
    `今日は${todayJST}です。AIエンジニア・研究者向けのデイリーレポートをMarkdown形式で作成してください。

以下のツールを順番に呼んで情報を揃えてから書いてください:
1. get_recent_articles(days=2, limit=20, minImportance=6) で直近記事を取得
2. get_statistics(days=7) でカテゴリ別トレンドを確認
3. get_knowledge_graph_summary() で検証済みの数値・事実を取得
4. get_reading_patterns(days=14) で読者の傾向を確認しトーンに反映
5. get_previous_report('daily') で前回との変化点を把握

【必須構成】
## 🔥 今日のハイライト
重要度8以上の記事を中心に3〜5点。「何が起きたか」「なぜ重要か」「実務への影響」を2〜3行で。

## 🚀 急上昇トレンド
今週急増しているカテゴリ・トピックを1段落で解説。

## 📊 カテゴリ別トピック
LLM推論/エージェント/ツール・フレームワーク/ハードウェア/ビジネス応用/研究・論文 ごとに整理。

## 💡 エンジニアへの実践的インサイト
実装・採用・評価のポイントを箇条書きで。

【ルール】全体1500〜2000文字。具体的な数値・ベンチマークを含める。絵文字・箇条書きを活用。`,
    { model: 'gemini-2.5-flash', maxSteps: 6 },
  ));

  const [insertedReport] = await db.insert(schema.reports).values({
    type: 'daily', content: text, reportDate: reportDateJST,
  }).returning({ id: schema.reports.id });

  // adoptionLogs: 直近2日の高重要度記事のソースを採用済みとして記録
  if (insertedReport?.id) {
    const adopted = await db.select({ sourceId: schema.collectedData.sourceId })
      .from(schema.collectedData)
      .where(and(gte(schema.collectedData.createdAt, since2d), gte(schema.collectedData.importanceScore, 7)));
    const sourceIds = [...new Set(adopted.map(d => d.sourceId).filter((id): id is number => id !== null))];
    if (sourceIds.length > 0) {
      await db.insert(schema.adoptionLogs).values(
        sourceIds.map(sourceId => ({ reportId: insertedReport.id, sourceId, isAdopted: 1 as const }))
      );
    }
  }

  console.log('[Report] レポート生成完了');
  return text;
}

async function generateWeeklyReport(): Promise<string | null> {
  console.log('[WeeklyReport] 週次レポート生成開始');

  const sevenDaysAgoISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [recentData, prevWeekly] = await Promise.all([
    db.select().from(schema.collectedData)
      .where(gte(schema.collectedData.createdAt, sevenDaysAgoISO))
      .orderBy(desc(schema.collectedData.importanceScore), desc(schema.collectedData.createdAt))
      .limit(70),
    db.select({ content: schema.reports.content })
      .from(schema.reports)
      .where(eq(schema.reports.type, 'weekly'))
      .orderBy(desc(schema.reports.createdAt))
      .limit(1),
  ]);

  if (recentData.length === 0) { console.log('[WeeklyReport] データなし、スキップ'); return null; }

  const contextStr = recentData
    .map(d => `[重要度:${d.importanceScore ?? 5}][${d.category ?? '未分類'}] ${d.title}\n${d.summary}`)
    .join('\n\n---\n\n');

  const prevSection = prevWeekly[0]?.content
    ? '\n\n---\n\n【前回の週次レポート（変化点分析用）】\n' + prevWeekly[0].content.substring(0, 600)
    : '';

  const todayJST = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });

  const { text } = await withRetry(() => generateText({
    model: google('gemini-2.5-flash'),
    system: `あなたはAI技術動向の専門アナリストです。過去1週間の収集データを元に、週次サマリーレポートをMarkdown形式で作成してください。

【必須構成】
## 🏆 今週の3大トピック
最重要ニュース3選。各項目は「何が起きたか」「なぜ重要か」「業界への影響」を2〜3行で。

## 📈 技術トレンドの週間まとめ
モデル・ツール・手法・インフラの動向。カテゴリ横断で今週のAI技術の全体像を俯瞰。

## 🔄 先週からの変化点
前回レポートと比較して新登場・消えたトレンド・注目度の変化を明示。

## 🔭 来週のウォッチポイント
今週の動向から予測される来週の注目ポイント。

【ルール】
- 全体2000〜2500文字
- 具体的なモデル名・手法名・数値を含める
- 絵文字・箇条書きを活用して読みやすく`,
    prompt: `今日の日付: ${todayJST}\n\n【今週の収集データ（${recentData.length}件）】\n${contextStr}${prevSection}`,
  }));

  const reportDateJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  await db.insert(schema.reports).values({ type: 'weekly', content: text, reportDate: reportDateJST });

  console.log('[WeeklyReport] 週次レポート生成完了');
  return text;
}

async function generateMonthlyReport(): Promise<string | null> {
  console.log('[MonthlyReport] 月次レポート生成開始');

  const thirtyDaysAgoISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [recentData, prevMonthly] = await Promise.all([
    db.select().from(schema.collectedData)
      .where(gte(schema.collectedData.createdAt, thirtyDaysAgoISO))
      .orderBy(desc(schema.collectedData.importanceScore), desc(schema.collectedData.createdAt))
      .limit(100),
    db.select({ content: schema.reports.content })
      .from(schema.reports)
      .where(eq(schema.reports.type, 'monthly'))
      .orderBy(desc(schema.reports.createdAt))
      .limit(1),
  ]);

  if (recentData.length === 0) { console.log('[MonthlyReport] データなし、スキップ'); return null; }

  const contextStr = recentData
    .map(d => `[重要度:${d.importanceScore ?? 5}][${d.category ?? '未分類'}] ${d.title}\n${d.summary}`)
    .join('\n\n---\n\n');

  const prevSection = prevMonthly[0]?.content
    ? '\n\n---\n\n【前月のレポート（変化点分析用）】\n' + prevMonthly[0].content.substring(0, 800)
    : '';

  const todayJST = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', timeZone: 'Asia/Tokyo' });

  const { text } = await withRetry(() => generateText({
    model: google('gemini-2.5-flash'),
    system: `あなたはAI技術動向の専門アナリストです。過去1ヶ月の収集データを元に、月次サマリーレポートをMarkdown形式で作成してください。

【必須構成】
## 🏅 今月の重大ニュース TOP5
最も影響の大きかった出来事5選。各項目は「何が起きたか」「なぜ重要か」「長期的な影響」を2〜3行で。

## 🔬 技術トレンド総括
モデル・インフラ・応用の各レイヤーでの1ヶ月の変化を体系的に整理。

## 🗺️ 業界地図の変化
プレイヤーの動向・勢力図の変化を分析。

## 📅 来月の展望
注目イベント・リリース予定・注視すべき動き。

【ルール】
- 全体3000文字程度
- 具体的なモデル名・数値・企業名を含める
- 絵文字・箇条書きを活用して読みやすく`,
    prompt: `対象月: ${todayJST}\n\n【今月の収集データ（${recentData.length}件）】\n${contextStr}${prevSection}`,
  }));

  const reportDateJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  await db.insert(schema.reports).values({ type: 'monthly', content: text, reportDate: reportDateJST });

  console.log('[MonthlyReport] 月次レポート生成完了');
  return text;
}

function markdownToHtml(md: string): string {
  let html = md
    .replace(/^## (.+)$/gm, '<h2 style="color:#38bdf8;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:8px;margin-top:28px;margin-bottom:12px">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="color:#818cf8;margin-top:16px;margin-bottom:8px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-family:monospace;font-size:0.9em">$1</code>')
    .replace(/^- (.+)$/gm, '<li style="margin:5px 0;line-height:1.6">$1</li>')
    .replace(/\n\n+/g, '\n\n');

  html = html.replace(/(<li[^>]*>[\s\S]*?<\/li>\n?)+/g, m => `<ul style="padding-left:20px;margin:8px 0">${m}</ul>`);
  html = html.replace(/\n\n/g, '</p><p style="margin:10px 0;line-height:1.7">');
  html = html.replace(/\n/g, '<br>');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#0f172a;color:#e2e8f0">
<p style="margin:10px 0;line-height:1.7">${html}</p>
</body></html>`;
}

async function sendEmail(reportContent: string, type: string = 'デイリー') {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.log('[Email] GMAIL_USER/GMAIL_APP_PASSWORD未設定、スキップ');
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });

    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });

    await transporter.sendMail({
      from: user,
      to: user,
      subject: `🤖 AI Tech Researcher ${type}レポート ${today}`,
      text: reportContent,
      html: markdownToHtml(reportContent),
    });

    console.log(`[Email] ${type}レポート送信完了`);
  } catch (e: any) {
    console.error(`[Email] 送信失敗: ${e.message}`);
  }
}

// v6: メール購読ユーザーへ「今日のあなた向け」パーソナライズbriefを配信（LLM不使用・低コスト）
async function sendPersonalizedBriefs() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) { console.log('[Brief] メール未設定、スキップ'); return; }

  const recipients = await db.select({
    uid: schema.users.id, email: schema.users.email, name: schema.users.name,
    displayName: schema.userProfiles.displayName, interests: schema.userProfiles.interests,
  })
    .from(schema.userProfiles)
    .innerJoin(schema.users, eq(schema.userProfiles.userId, schema.users.id))
    .where(eq(schema.userProfiles.emailOptIn, 1));
  if (recipients.length === 0) { console.log('[Brief] 購読者なし'); return; }

  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });
  let sent = 0;

  for (const r of recipients) {
    if (!r.email) continue;
    try {
      // 関心カテゴリ（行動ログの重み合計上位）
      const cats = await db.select({ category: schema.readingEvents.category, w: sql<number>`SUM(${schema.readingEvents.weight})` })
        .from(schema.readingEvents)
        .where(eq(schema.readingEvents.userId, r.uid))
        .groupBy(schema.readingEvents.category)
        .orderBy(desc(sql`SUM(${schema.readingEvents.weight})`))
        .limit(4);
      const topCats = new Set(cats.map(c => c.category).filter(Boolean) as string[]);
      const interestKws = (r.interests ?? '').toLowerCase().split(/[,、\s]+/).filter(s => s.length >= 2);

      // 直近2日・未読・重要度6以上の候補（最大25件）
      const cand = await client.execute({
        sql: `SELECT cd.id AS id, cd.title AS title, cd.title_ja AS titleJa, cd.category AS category,
                     cd.url AS url, cd.summary AS summary, cd.importance_score AS imp
              FROM collected_data cd
              LEFT JOIN user_article_state uas ON uas.article_id = cd.id AND uas.user_id = ?
              WHERE cd.created_at >= ? AND cd.importance_score >= 6 AND COALESCE(uas.is_read, 0) = 0
              ORDER BY cd.importance_score DESC LIMIT 25`,
        args: [r.uid, twoDaysAgo],
      });
      // 興味で加点して上位6件
      const ranked = (cand.rows as any[]).map(a => {
        const text = `${a.title ?? ''} ${a.titleJa ?? ''} ${a.category ?? ''}`.toLowerCase();
        let score = Number(a.imp ?? 5);
        if (a.category && topCats.has(a.category)) score += 5;
        if (interestKws.some(k => text.includes(k))) score += 4;
        return { a, score };
      }).sort((x, y) => y.score - x.score).slice(0, 6).map(x => x.a);
      if (ranked.length === 0) continue;

      const items = ranked.map(a => `
        <div style="margin:0 0 12px;padding:12px;border:1px solid #e2e8f0;border-radius:10px;">
          <div style="font-size:11px;color:#64748b;">${a.category ?? ''} ・ ★${a.imp}</div>
          <a href="${a.url ?? '#'}" style="font-size:15px;font-weight:600;color:#0f172a;text-decoration:none;">${a.titleJa || a.title || '無題'}</a>
          <div style="font-size:12px;color:#475569;margin-top:4px;">${(a.summary ?? '').slice(0, 120)}</div>
        </div>`).join('');
      const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
        <h2 style="color:#0ea5e9;">☀️ ${r.displayName || r.name || 'あなた'}さんへ — 今日のおすすめ</h2>
        <p style="font-size:13px;color:#64748b;">あなたの興味に近い新着 ${ranked.length}件です。</p>
        ${items}
        <p style="font-size:11px;color:#94a3b8;margin-top:16px;">配信停止は設定タブのプロフィールから。</p>
      </div>`;

      await transporter.sendMail({
        from: user, to: r.email,
        subject: `☀️ 今日のあなた向け AI記事 ${today}`,
        html,
      });
      sent++;
    } catch (e: any) {
      console.warn(`[Brief] ${r.email} 送信失敗: ${(e.message ?? '').slice(0, 60)}`);
    }
  }
  console.log(`[Brief] パーソナライズbrief配信: ${sent}/${recipients.length}件`);
}

async function sendFailureEmail(error: Error) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return;
  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });
    await transporter.sendMail({
      from: user,
      to: user,
      subject: `🚨 AI Tech Researcher パイプライン失敗 ${today}`,
      text: `デイリーパイプラインが失敗しました。\n\nエラー: ${error.message}\n\nスタックトレース:\n${error.stack ?? '(なし)'}`,
    });
    console.log('[Email] 失敗通知送信完了');
  } catch (e: any) {
    console.error(`[Email] 失敗通知の送信に失敗: ${e.message}`);
  }
}

// ── v3.2 抽出品質ゲート ───────────────────────────────────────────────
// 文の断片・一般名詞をエンティティとして弾く（ASCIIで大文字/数字が無い＝固有名詞でない可能性大）
function looksLikeEntity(s: string): boolean {
  const t = (s ?? '').trim();
  if (!t || t.length > 40) return false;
  if (/[、,]/.test(t)) return false;            // カンマ/読点 = 文の断片
  if (t.split(/\s+/).length > 5) return false;  // 単語数過多 = 文
  const hasCJK = /[ぁ-んァ-ヶ一-龯]/.test(t);
  const hasUpperOrDigit = /[A-Z0-9]/.test(t);
  if (!hasCJK && !hasUpperOrDigit) return false; // 小文字ASCIIのみ = 一般名詞の可能性大
  return true;
}

// ハードウェアスペック・価格等はベンチマークでないため除外
const BENCH_SPEC_RE = /(cores?|RAM|メモリ|memory|TOPS|MHz|GHz|\dGB|\dMB|\dKB|nm\b|watt|ワット|price|価格|cost|円|ドル|\$|tokens?\/s|context window|コンテキスト|parameters?|params?|パラメータ)/i;
function isValidBenchmarkName(name: string): boolean {
  const t = (name ?? '').trim();
  if (!t || t.length < 2 || t.length > 50) return false;
  if (BENCH_SPEC_RE.test(t)) return false;
  return true;
}

// ベンチマーク名の表記ゆれを正規化（リーダーボード集約のため）
const BENCH_ALIASES: [RegExp, string][] = [
  [/chatbot\s*arena|lmarena|arena\s*elo/i, 'Chatbot Arena (Elo)'],
  [/mmlu[-\s]?pro/i, 'MMLU-Pro'],
  [/\bmmlu\b/i, 'MMLU'],
  [/gsm[-\s]?8k/i, 'GSM8K'],
  [/swe[-\s]?bench/i, 'SWE-bench'],
  [/human\s*eval/i, 'HumanEval'],
  [/\bmmmu\b/i, 'MMMU'],
  [/\bgpqa\b/i, 'GPQA'],
  [/\baime\b/i, 'AIME'],
  [/arc[-\s]?agi/i, 'ARC-AGI'],
  [/live\s*code\s*bench/i, 'LiveCodeBench'],
];
function canonicalBenchmarkName(name: string): string {
  const t = (name ?? '').trim();
  for (const [re, canon] of BENCH_ALIASES) if (re.test(t)) return canon;
  return t;
}

// ── v3: エンティティ正規化（GPT-4o / GPT4o / gpt-4 omni → 同一ノード）─────
let _entityCache: Map<string, { id: number; canonicalName: string }> = new Map();

// 既知の主要モデル/企業の表記ゆれ → 正規キー（NFKC・英数字のみ化の前に適用）
const ENTITY_ALIAS_KEYS: [RegExp, string][] = [
  [/^gpt[-\s]?4\s*o(mni)?$/i, 'gpt4o'],
  [/^gpt[-\s]?4\.?5$/i, 'gpt45'],
  [/^claude\s*3\.?5\s*sonnet$/i, 'claude35sonnet'],
  [/^gemini\s*1\.?5\s*(pro|flash)$/i, 'gemini15$1'],
];
function normalizeEntityKey(name: string): string {
  const t = (name ?? '').trim();
  for (const [re, key] of ENTITY_ALIAS_KEYS) {
    const m = t.match(re);
    if (m) return key.replace('$1', (m[1] ?? '').toLowerCase());
  }
  return t.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function resolveEntity(rawName: string, type = 'model'): Promise<{ id: number; canonicalName: string } | null> {
  const name = (rawName ?? '').trim();
  const key = normalizeEntityKey(name);
  if (!key || key.length < 2) return null;
  if (_entityCache.has(key)) return _entityCache.get(key)!;

  const existing = await db.select({ id: schema.entities.id, canonicalName: schema.entities.canonicalName })
    .from(schema.entities).where(eq(schema.entities.normalizedKey, key)).limit(1);
  if (existing.length) {
    await db.update(schema.entities)
      .set({ mentionCount: sql`COALESCE(${schema.entities.mentionCount}, 0) + 1`, updatedAt: new Date().toISOString() })
      .where(eq(schema.entities.id, existing[0].id));
    _entityCache.set(key, existing[0]);
    return existing[0];
  }

  const inserted = await db.insert(schema.entities)
    .values({ canonicalName: name, normalizedKey: key, type })
    .onConflictDoNothing()
    .returning({ id: schema.entities.id, canonicalName: schema.entities.canonicalName });
  if (inserted[0]) { _entityCache.set(key, inserted[0]); return inserted[0]; }

  // 競合（同時挿入）時は再取得
  const refetch = await db.select({ id: schema.entities.id, canonicalName: schema.entities.canonicalName })
    .from(schema.entities).where(eq(schema.entities.normalizedKey, key)).limit(1);
  if (refetch[0]) { _entityCache.set(key, refetch[0]); return refetch[0]; }
  return null;
}

// 知識抽出プロンプト本体（同期・Batch共通）。出力形式の足場だけ呼び出し側で足す。
function buildExtractionPrompt(article: { title: string | null; rawContent: string | null; summary: string | null }): string {
  return `以下の記事から構造化された知識を抽出してください。該当がなければ空配列。

【claims】検証可能な具体的主張を最大3つ。subject(主語:モデル/企業名はそのまま)+predicate(述語:指標を**日本語**で)+value(具体値を**日本語**で。固有名詞・数値は原語可)。「AIが進化」等の汎用主張は除外。
【benchmarks】AIモデル/システムの「評価ベンチマークスコア」のみ最大5つ。entity(モデル名)+benchmark(ベンチ名)+score(比較可能な数値)+unit(%/points/Elo等、不明はnull)。
  対象例: MMLU, GSM8K, SWE-bench, HumanEval, MMMU, GPQA, AIME, MATH, Chatbot Arena Elo, ARC-AGI 等。
  除外: CPUコア数・RAM/メモリ容量・TOPS・クロック等のハードウェアスペック、価格、トークン数、'1'のような順位/件数、ベンチ名が曖昧なもの。
【relations】エンティティ間の明確な関係を最大5つ。subject+relation(${RELATION_TYPES.join('/')})+object。具体的な固有名詞同士のみ（一般名詞・文の断片は除外）。例: "Claude 4" outperforms "GPT-4"。

【抽出してはいけないもの（最重要・該当は確信度を下げるのでなく"そもそも抽出しない"）】
- 推測・予測・願望: 「〜かもしれない」「〜だろう」「将来は〜」「期待される」等の未確定な記述
- 伝聞・噂・リーク・未確認情報: 「〜と噂される」「リークによれば」「報じられている」等の裏取りされていない記述
- 第三者の主観的な意見・評価・コメント: 「画期的だ」「優れていると感じる」等（※企業/論文が公表した客観的なベンチ数値・事実は抽出してよい）
- 絶対値を伴わない相対表現: 「Aより速い/高い」だけで具体的な数値・指標がないもの（数値の裏付けがある事実のみ）

記事: ${article.title ?? ''}\n${(article.rawContent ?? article.summary ?? '').slice(0, 3000)}`;
}

// 抽出結果(KnowledgeSchema)をDBへ反映（同期・Batch共通: 正規化/フィルタ/stale移行/裏付けブースト）。
// 完了後、記事の extraction_version を現行に更新し再抽出対象から外す。
async function ingestKnowledge(
  article: { id: number; url: string | null },
  validFrom: string,
  parsed: z.infer<typeof KnowledgeSchema>,
  opts: { replace?: boolean } = {},
): Promise<{ claims: number; benchmarks: number; relations: number; stale: number }> {
  // replace=true（Batch再抽出）: 改善ロジックでこの記事の寄与を新規導出として作り直す。
  // 既存claims/benchmarks/relationsを削除→再挿入。confidence_scoreは0.7から再スタート（仕様）。
  // 裏付けブースト・stale移行はスキップ（バルク再導出での確信度インフレ・staleバタつき回避）。
  // ※claim確信度を保つ差分マージは、LLMの言い換えで一致せず実質replaceだったため不採用。
  const replace = opts.replace ?? false;
  if (replace) {
    await db.delete(schema.claims).where(eq(schema.claims.articleId, article.id));
    await db.delete(schema.benchmarks).where(eq(schema.benchmarks.articleId, article.id));
    await db.delete(schema.relations).where(eq(schema.relations.articleId, article.id));
  }

  let claims = 0, benchmarks = 0, relations = 0, stale = 0;

  // ── claims（stale移行つき）──
  for (const claim of parsed.claims) {
    const entity = await resolveEntity(claim.subject);
    // 同一subject+predicateで異なるvalueの既存activeクレームをstaleに
    if (!replace && claim.confidence === 'high') {
      const res = await db.update(schema.claims)
        .set({ status: 'stale' })
        .where(and(
          eq(schema.claims.subject, claim.subject),
          eq(schema.claims.predicate, claim.predicate),
          sql`LOWER(${schema.claims.value}) != ${claim.value.toLowerCase()}`,
          eq(schema.claims.status, 'active'),
        ));
      stale += res.rowsAffected;
    }
    // 裏付けブースト: 同一エンティティ+predicateの既存activeクレームの確信度を引き上げる
    if (!replace && entity?.id) {
      await client.execute({
        sql: `UPDATE claims SET confidence_score = MIN(0.95, COALESCE(confidence_score, 0.7) + 0.08)
              WHERE entity_id = ? AND predicate = ? AND status = 'active'`,
        args: [entity.id, claim.predicate],
      });
    }
    await db.insert(schema.claims).values({
      articleId: article.id,
      subject: claim.subject,
      predicate: claim.predicate,
      value: claim.value,
      confidence: claim.confidence,
      entityId: entity?.id ?? null,
      validFrom,
      status: 'active',
    }).onConflictDoNothing();
    claims++;
  }

  // ── benchmarks（時系列なので全件保存。スペック等のノイズは除外）──
  for (const b of parsed.benchmarks) {
    if (!Number.isFinite(b.score)) continue;
    if (!isValidBenchmarkName(b.benchmark)) continue;       // ハードスペック/価格等を除外
    if (!looksLikeEntity(b.entity)) continue;               // エンティティが文の断片なら除外
    const entity = await resolveEntity(b.entity);
    await db.insert(schema.benchmarks).values({
      entityId: entity?.id ?? null,
      entityName: entity?.canonicalName ?? b.entity.trim(),
      benchmarkName: canonicalBenchmarkName(b.benchmark),  // 表記ゆれを正規化
      score: b.score,
      unit: b.unit ?? null,
      articleId: article.id,
      sourceUrl: article.url,
      recordedDate: validFrom,
      confidence: b.confidence,
    });
    benchmarks++;
  }

  // ── relations（断片を除外・エッジ重複排除・矛盾stale）──
  for (const r of parsed.relations) {
    if (!looksLikeEntity(r.subject) || !looksLikeEntity(r.object)) continue; // 文の断片を除外
    const subj = await resolveEntity(r.subject);
    const obj = await resolveEntity(r.object);
    const subjName = subj?.canonicalName ?? r.subject.trim();
    const objName = obj?.canonicalName ?? r.object.trim();
    if (!subjName || !objName || subjName === objName) continue;

    // outperforms の逆向きactiveエッジをstaleに（A>B が来たら B>A を陳腐化）
    if (!replace && r.relation === 'outperforms') {
      const res = await db.update(schema.relations)
        .set({ status: 'stale' })
        .where(and(
          eq(schema.relations.relationType, 'outperforms'),
          eq(schema.relations.subjectName, objName),
          eq(schema.relations.objectName, subjName),
          eq(schema.relations.status, 'active'),
        ));
      stale += res.rowsAffected;
    }

    await db.insert(schema.relations).values({
      subjectEntityId: subj?.id ?? null,
      subjectName: subjName,
      relationType: r.relation,
      objectEntityId: obj?.id ?? null,
      objectName: objName,
      articleId: article.id,
      confidence: r.confidence,
      validFrom,
      status: 'active',
    }).onConflictDoUpdate({
      target: [schema.relations.subjectName, schema.relations.relationType, schema.relations.objectName],
      set: { articleId: article.id, confidence: r.confidence, validFrom, status: 'active' },
    });
    relations++;
  }

  // 抽出済みバージョンを刻印（Batch再抽出の対象から外れる）
  await db.update(schema.collectedData)
    .set({ extractionVersion: EXTRACTION_VERSION })
    .where(eq(schema.collectedData.id, article.id));

  return { claims, benchmarks, relations, stale };
}

// ── v3: 知識抽出（claims + benchmarks + relations を1回の呼び出しで）──────
async function runKnowledgeExtraction(sinceDays = 1, limit = 10) {
  console.log('[Knowledge] 知識抽出開始');
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  const targets = await db.select({
    id: schema.collectedData.id,
    title: schema.collectedData.title,
    summary: schema.collectedData.summary,
    rawContent: schema.collectedData.rawContent,
    url: schema.collectedData.url,
    publishedAt: schema.collectedData.publishedAt,
  })
    .from(schema.collectedData)
    .where(and(
      gte(schema.collectedData.importanceScore, 7),
      gte(schema.collectedData.createdAt, since),
    ))
    .orderBy(desc(schema.collectedData.importanceScore), desc(schema.collectedData.createdAt))
    .limit(limit);

  if (targets.length === 0) { console.log('[Knowledge] 対象記事なし'); return; }

  let claimCount = 0, benchCount = 0, relCount = 0, staleCount = 0;

  for (const article of targets) {
    const validFrom = (article.publishedAt ?? new Date().toISOString()).split('T')[0];
    try {
      const { object } = await withRetry(() => generateObject({
        model: google('gemini-2.5-flash-lite'),
        schema: KnowledgeSchema,
        prompt: buildExtractionPrompt(article),
      }));
      const c = await ingestKnowledge(article, validFrom, object);
      claimCount += c.claims; benchCount += c.benchmarks; relCount += c.relations; staleCount += c.stale;
    } catch (e: any) {
      console.warn(`  [Knowledge] 抽出失敗 (article ${article.id}): ${(e.message ?? '').slice(0, 60)}`);
    }
  }

  console.log(`[Knowledge] claims${claimCount}, benchmarks${benchCount}, relations${relCount}, stale移行${staleCount}`);

  await runRelationInference();
}

// ── v3: outperforms の推移推論（A>B かつ B>C → A>C を inferred として生成）──
async function runRelationInference() {
  try {
    const edges = await db.select({
      subjectName: schema.relations.subjectName,
      subjectEntityId: schema.relations.subjectEntityId,
      objectName: schema.relations.objectName,
      objectEntityId: schema.relations.objectEntityId,
    })
      .from(schema.relations)
      .where(and(
        eq(schema.relations.relationType, 'outperforms'),
        eq(schema.relations.status, 'active'),
      ));

    if (edges.length < 2) return;

    const adj = new Map<string, Array<{ name: string; entityId: number | null }>>();
    const idOf = new Map<string, number | null>();
    const existing = new Set<string>();
    for (const e of edges) {
      if (!adj.has(e.subjectName)) adj.set(e.subjectName, []);
      adj.get(e.subjectName)!.push({ name: e.objectName, entityId: e.objectEntityId });
      idOf.set(e.subjectName, e.subjectEntityId);
      idOf.set(e.objectName, e.objectEntityId);
      existing.add(`${e.subjectName}→${e.objectName}`);
    }

    const today = new Date().toISOString().split('T')[0];
    let inferred = 0;
    for (const [a, bs] of adj) {
      for (const b of bs) {
        const cs = adj.get(b.name);
        if (!cs) continue;
        for (const c of cs) {
          if (c.name === a) continue; // 循環は除外
          const key = `${a}→${c.name}`;
          if (existing.has(key)) continue; // 直接エッジがあれば推論不要
          existing.add(key);
          const res = await db.insert(schema.relations).values({
            subjectEntityId: idOf.get(a) ?? null,
            subjectName: a,
            relationType: 'outperforms',
            objectEntityId: c.entityId ?? null,
            objectName: c.name,
            articleId: null,
            confidence: 'low',
            validFrom: today,
            status: 'inferred',
          }).onConflictDoNothing(); // 実エッジ（active/stale）は上書きしない
          inferred += res.rowsAffected;
          if (inferred >= 30) { console.log(`[Knowledge] 推論${inferred}件（上限到達）`); return; }
        }
      }
    }
    if (inferred > 0) console.log(`[Knowledge] 推移推論${inferred}件生成`);
  } catch (e: any) {
    console.warn('[Knowledge] 推論失敗(非クリティカル):', e.message);
  }
}

// ── Batch遡及再抽出: 改善した抽出ロジックを過去コーパスへ半額(50%オフ)で適用 ──────
// extraction_version が現行未満の記事を Gemini Batch API でまとめて再抽出する。
// 非同期(目標24h・48h失効)のため日次cronには載せず、手動で2段実行する:
//   PIPELINE_MODE=batch_submit → ジョブ投入（batch_state.jsonに保存）
//   PIPELINE_MODE=batch_fetch  → 完了をポーリングしDBへ取り込み（再実行は冪等）
const BATCH_STATE_PATH = 'batch_state.json';
const BATCH_MODEL = 'gemini-2.5-flash-lite';

// Batch出力の構造を強制する responseSchema（generateObjectのZodスキーマ強制と同等。KnowledgeSchemaに対応）
const CONF_ENUM = ['high', 'medium', 'low'];
const EXTRACTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    claims: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING }, predicate: { type: Type.STRING }, value: { type: Type.STRING },
          confidence: { type: Type.STRING, enum: CONF_ENUM },
        },
        required: ['subject', 'predicate', 'value', 'confidence'],
      },
    },
    benchmarks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          entity: { type: Type.STRING }, benchmark: { type: Type.STRING }, score: { type: Type.NUMBER },
          unit: { type: Type.STRING, nullable: true }, confidence: { type: Type.STRING, enum: CONF_ENUM },
        },
        required: ['entity', 'benchmark', 'score', 'confidence'],
      },
    },
    relations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING }, relation: { type: Type.STRING, enum: [...RELATION_TYPES] }, object: { type: Type.STRING },
          confidence: { type: Type.STRING, enum: CONF_ENUM },
        },
        required: ['subject', 'relation', 'object', 'confidence'],
      },
    },
  },
  required: ['claims', 'benchmarks', 'relations'],
};

interface BatchState {
  version: number;
  submittedAt: string;
  jobs: { name: string; articleIds: number[]; ingested?: boolean }[];
}

async function runBatchSubmit(
  maxArticles = Number(process.env.BATCH_MAX ?? 3000),
  chunkSize = Number(process.env.BATCH_CHUNK ?? 150),
) {
  console.log(`[Batch] 再抽出ジョブ投入開始 (EXTRACTION_VERSION=${EXTRACTION_VERSION}, max=${maxArticles})`);
  const targets = await db.select({
    id: schema.collectedData.id,
    title: schema.collectedData.title,
    summary: schema.collectedData.summary,
    rawContent: schema.collectedData.rawContent,
  })
    .from(schema.collectedData)
    .where(and(
      gte(schema.collectedData.importanceScore, 7),
      sql`COALESCE(${schema.collectedData.extractionVersion}, 0) < ${EXTRACTION_VERSION}`,
    ))
    .orderBy(desc(schema.collectedData.importanceScore))
    .limit(maxArticles);

  if (targets.length === 0) { console.log('[Batch] 再抽出対象なし（全記事が最新バージョン）'); return; }

  const state: BatchState = { version: EXTRACTION_VERSION, submittedAt: new Date().toISOString(), jobs: [] };
  for (let i = 0; i < targets.length; i += chunkSize) {
    const slice = targets.slice(i, i + chunkSize);
    const src = slice.map(a => ({
      contents: [{ role: 'user', parts: [{ text: buildExtractionPrompt(a) }] }],
      config: { responseMimeType: 'application/json', responseSchema: EXTRACTION_RESPONSE_SCHEMA },
    }));
    const job: any = await genai.batches.create({
      model: BATCH_MODEL,
      src: src as any,
      config: { displayName: `reextract-v${EXTRACTION_VERSION}-${i}` },
    });
    if (!job?.name) { console.warn('[Batch] ジョブ名が取得できずスキップ'); continue; }
    state.jobs.push({ name: job.name, articleIds: slice.map(a => a.id) });
    writeFileSync(BATCH_STATE_PATH, JSON.stringify(state, null, 2)); // 投入ごとに保存（途中失敗でも投入済みを記録）
    console.log(`[Batch] 投入: ${job.name} (${slice.length}件)`);
  }

  console.log(`[Batch] ${state.jobs.length}ジョブ・計${targets.length}件を投入。${BATCH_STATE_PATH} に保存。完了後 PIPELINE_MODE=batch_fetch で取り込み。`);
}

// Batchのインライン応答からテキストを取り出す。思考(thought)partは除外して本文textのみ連結する。
function batchResponseText(resp: any): string | null {
  const r = resp?.response;
  if (!r) return null;
  const parts = r.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts.filter((p: any) => !p?.thought).map((p: any) => p?.text ?? '').join('');
    if (t) return t;
  }
  if (typeof r.text === 'string') return r.text;
  if (typeof r.text === 'function') { try { const t = r.text(); if (typeof t === 'string') return t; } catch { /* fallthrough */ } }
  return null;
}

// 文字列から最初の波括弧バランスの取れたJSONオブジェクトだけを取り出す。
// 複数オブジェクト連結・末尾余分・前後の文章があっても先頭の1個を確実に拾う。
function firstBalancedJson(text: string): unknown | null {
  const s = text.replace(/```json/gi, '').replace(/```/g, '');
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
    }
  }
  return null;
}

async function runBatchFetch() {
  if (!existsSync(BATCH_STATE_PATH)) { console.log(`[Batch] ${BATCH_STATE_PATH} がない。先に PIPELINE_MODE=batch_submit を実行。`); return; }
  const state = JSON.parse(readFileSync(BATCH_STATE_PATH, 'utf-8')) as BatchState;
  const DONE = new Set(['JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED']);
  let ingested = 0, failed = 0;

  for (const j of state.jobs) {
    if (j.ingested) { console.log(`[Batch] ${j.name}: 取り込み済みスキップ`); continue; }

    let job: any = await genai.batches.get({ name: j.name });
    while (!DONE.has(job?.state)) {
      console.log(`[Batch] ${j.name}: ${job?.state} … 30秒待機`);
      await new Promise(res => setTimeout(res, 30000));
      job = await genai.batches.get({ name: j.name });
    }
    if (job?.state !== 'JOB_STATE_SUCCEEDED') {
      console.warn(`[Batch] ${j.name} 未成功(${job?.state})。対象はバージョン据置で再投入可。`);
      continue;
    }

    // 記事のurl/publishedAt/現バージョンをまとめて取得（再ingest防止に version も見る）
    const arts = await db.select({
      id: schema.collectedData.id,
      url: schema.collectedData.url,
      publishedAt: schema.collectedData.publishedAt,
      ver: schema.collectedData.extractionVersion,
    }).from(schema.collectedData).where(inArray(schema.collectedData.id, j.articleIds));
    const artMap = new Map(arts.map(a => [a.id, a]));

    const responses: any[] = job?.dest?.inlinedResponses ?? [];
    for (let i = 0; i < j.articleIds.length; i++) {
      const articleId = j.articleIds[i];
      const art = artMap.get(articleId);
      if (!art) continue;
      if ((art.ver ?? 0) >= EXTRACTION_VERSION) continue; // 既に取り込み済み（再実行の冪等性）
      const resp = responses[i];
      if (resp?.error) { failed++; continue; }
      const text = batchResponseText(resp);
      if (!text) { failed++; continue; }
      const raw = firstBalancedJson(text); // 連結/末尾余分に強い第1オブジェクト抽出
      if (raw === null) { failed++; continue; }
      const parsed = KnowledgeSchema.safeParse(raw);
      if (!parsed.success) { failed++; continue; }
      const validFrom = (art.publishedAt ?? new Date().toISOString()).split('T')[0];
      try {
        await ingestKnowledge({ id: articleId, url: art.url }, validFrom, parsed.data, { replace: true });
        ingested++;
      } catch (e: any) {
        console.warn(`[Batch] ingest失敗 (article ${articleId}): ${(e.message ?? '').slice(0, 50)}`);
        failed++;
      }
    }
    j.ingested = true;
    writeFileSync(BATCH_STATE_PATH, JSON.stringify(state, null, 2));
    console.log(`[Batch] ${j.name}: 取り込み完了`);
  }

  await runRelationInference();
  console.log(`[Batch] 完了: 反映${ingested}件 / 失敗${failed}件`);
}

// ── v3: 先読みアラート検知（理由付き。知識グラフを根拠に使う）──────────
async function detectAlerts() {
  console.log('[Alerts] アラート検知開始');
  let created = 0;
  const recent7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const since2dISO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const insertAlert = async (a: {
    type: string; title: string; reason: string; entityName?: string | null;
    severity?: string; relatedArticleId?: number | null; dedupeKey: string;
  }) => {
    const r = await db.insert(schema.alerts).values({
      type: a.type, title: a.title, reason: a.reason,
      entityName: a.entityName ?? null, severity: a.severity ?? 'watch',
      relatedArticleId: a.relatedArticleId ?? null, dedupeKey: a.dedupeKey, status: 'active',
    }).onConflictDoNothing();
    if (r.rowsAffected > 0) created++;
  };

  // 1. ベンチマークのリーダー交代（直近7日に発生したもののみ）
  try {
    const rows = await db.select({
      benchmarkName: schema.benchmarks.benchmarkName,
      entityName: schema.benchmarks.entityName,
      score: schema.benchmarks.score,
      recordedDate: schema.benchmarks.recordedDate,
    })
      .from(schema.benchmarks)
      .orderBy(asc(schema.benchmarks.benchmarkName), asc(schema.benchmarks.recordedDate), asc(schema.benchmarks.createdAt));

    let curBench = '', maxScore = -Infinity, leader = '';
    for (const r of rows) {
      if (r.benchmarkName !== curBench) { curBench = r.benchmarkName; maxScore = -Infinity; leader = ''; }
      if (r.score > maxScore) {
        if (leader && r.entityName !== leader && (r.recordedDate ?? '') >= recent7) {
          await insertAlert({
            type: 'benchmark_lead_change',
            title: `${r.benchmarkName}: ${r.entityName}が首位に`,
            reason: `${r.entityName}が${r.benchmarkName}で${r.score}を記録し、これまで首位だった${leader}(${maxScore})を上回りました。追跡中の指標で順位が動いています。`,
            entityName: r.entityName, severity: 'high',
            dedupeKey: `bench:${r.benchmarkName}:${r.entityName}:${leader}`,
          });
        }
        maxScore = r.score; leader = r.entityName;
      }
    }
  } catch (e: any) { console.warn('  [Alerts] ベンチ検知失敗:', e.message?.slice(0, 60)); }

  // 2. 直近に追加された競合/優位/置換の関係
  try {
    const rels = await db.select({
      subjectName: schema.relations.subjectName,
      relationType: schema.relations.relationType,
      objectName: schema.relations.objectName,
      articleId: schema.relations.articleId,
    })
      .from(schema.relations)
      .where(and(
        eq(schema.relations.status, 'active'),
        gte(schema.relations.createdAt, since2dISO),
        sql`${schema.relations.relationType} IN ('outperforms', 'supersedes', 'competes_with')`,
      ))
      .limit(8);

    const relLabel: Record<string, string> = { outperforms: '性能で上回った', supersedes: '置き換えようとしている', competes_with: '競合関係にある' };
    // 文の断片のようなエンティティ（長すぎ・カンマ含み）はアラートにしない
    const looksLikeEntity = (s: string) => s.length <= 40 && !s.includes('、') && !/,\s/.test(s) && s.split(' ').length <= 5;
    for (const r of rels) {
      if (!looksLikeEntity(r.subjectName) || !looksLikeEntity(r.objectName)) continue;
      const label = relLabel[r.relationType] ?? r.relationType;
      const watchHint = r.relationType === 'supersedes'
        ? '乗り換え・移行を検討する価値があります。'
        : r.relationType === 'outperforms'
          ? `${r.objectName}を使っている場合は${r.subjectName}の評価を推奨します。`
          : '比較検討の候補になります。';
      await insertAlert({
        type: 'new_competitor',
        title: `${r.subjectName} が ${r.objectName} を${label}`,
        reason: `「${r.subjectName}」が「${r.objectName}」を${label}という情報が新たに観測されました。${watchHint}`,
        entityName: r.subjectName, severity: 'watch',
        relatedArticleId: r.articleId, dedupeKey: `rel:${r.subjectName}:${r.relationType}:${r.objectName}`,
      });
    }
  } catch (e: any) { console.warn('  [Alerts] 関係検知失敗:', e.message?.slice(0, 60)); }

  // 3. 注目の急増（言及の先読み）: claims.subjectの出現が先週比で急増したエンティティ
  try {
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const [thisWeek, prevWeek] = await Promise.all([
      db.select({ subject: schema.claims.subject, c: count() })
        .from(schema.claims).where(gte(schema.claims.createdAt, since7)).groupBy(schema.claims.subject),
      db.select({ subject: schema.claims.subject, c: count() })
        .from(schema.claims).where(and(gte(schema.claims.createdAt, since14), lt(schema.claims.createdAt, since7))).groupBy(schema.claims.subject),
    ]);
    const prevMap = new Map(prevWeek.map(r => [r.subject, Number(r.c)]));
    for (const t of thisWeek) {
      const nowC = Number(t.c);
      const prevC = prevMap.get(t.subject) ?? 0;
      if (nowC >= 3 && nowC >= prevC * 2 && looksLikeEntity(t.subject)) {
        await insertAlert({
          type: 'trend_surge',
          title: `${t.subject} への注目が急増`,
          reason: `「${t.subject}」への言及が先週${prevC}件→今週${nowC}件に急増しています。近く重要な発表・動向がある可能性があり、先回りでの確認をおすすめします。`,
          entityName: t.subject,
          severity: nowC >= 5 ? 'high' : 'watch',
          dedupeKey: `surge:${t.subject}:${today}`,
        });
      }
    }
  } catch (e: any) { console.warn('  [Alerts] 急増検知失敗:', e.message?.slice(0, 60)); }

  console.log(`[Alerts] ${created}件の新規アラート`);
}

// ── DB連携エージェントによる問い生成（探索型。事前パッケージ不要）──────────
// エージェントがツールでDBを自律探索し、文脈を理解した上で研究問いを生成する。
// 事前にデータをまとめてLLMに渡す方式と違い、エージェントが「必要なものだけ」を取りにいく。
async function generateResearchQuestionsAgent() {
  console.log('[Research] エージェント問い生成開始');
  const sevenDaysAgoISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const existing = await db.select({ q: schema.researchQuestions.question })
    .from(schema.researchQuestions)
    .where(gte(schema.researchQuestions.createdAt, sevenDaysAgoISO));
  const existingSet = new Set(existing.map(e => e.q.trim().toLowerCase()));

  try {
    const { text } = await withRetry(() => generateText({
      model: google('gemini-2.5-flash-lite'),
      stopWhen: stepCountIs(7),
      system: `あなたはAI技術コーパスのリサーチギャップ分析エージェントです。
ツールでデータベースを自律的に探索し、今夜の追加調査に最も価値のある「問い」を最大4つ生成してください。

【探索の優先度】
1. 確信度が低下しているエンティティ（古くなった情報が残っている可能性 → get_stale_entities）
2. 今週カバレッジが薄いカテゴリ（見落とし → get_topic_coverage）
3. 最近のアラートが示す変化（裏取りが必要 → get_recent_alerts）
4. 特定エンティティの詳細状態を確認したい場合 → get_entity_status
5. トピックが既にコーパスで充分カバーされているか確認 → check_corpus_coverage

【最終出力形式（ツール探索完了後）】
以下のJSONのみを出力してください（コードブロック不要）:
{"questions":[{"question":"...","origin":"gap|followup|tracking|contradiction","rationale":"..."}]}`,
      prompt: `今日は${new Date().toISOString().slice(0, 10)}です。ツールでデータベースを探索し、今夜調査すべき問いを生成してください。`,
      tools: {
        get_stale_entities: tool({
          description: '確信度が低下しているエンティティ（古くなった情報の持ち主）を一覧取得する',
          inputSchema: z.object({ limit: z.number().int().min(1).max(15).default(8) }),
          execute: async ({ limit }) => {
            const rows = await client.execute({
              sql: `SELECT e.canonical_name, AVG(COALESCE(c.confidence_score, 0.7)) AS avg_conf,
                           COUNT(c.id) AS claim_count, MAX(c.valid_from) AS last_updated
                    FROM entities e
                    JOIN claims c ON c.entity_id = e.id AND c.status = 'active'
                    GROUP BY e.id, e.canonical_name
                    HAVING COUNT(c.id) >= 1
                    ORDER BY avg_conf ASC LIMIT ?`,
              args: [limit],
            });
            if ((rows.rows as any[]).length === 0) return '確信度低下エンティティなし';
            return (rows.rows as any[]).map((r: any) =>
              `${r.canonical_name}: 平均確信度${Number(r.avg_conf).toFixed(2)}, ${r.claim_count}クレーム, 最終更新${r.last_updated ?? '不明'}`
            ).join('\n');
          },
        }),
        get_entity_status: tool({
          description: '特定エンティティの詳細状態（ベンチマーク・クレーム・関係）を取得する',
          inputSchema: z.object({ entityName: z.string().max(80) }),
          execute: async ({ entityName }) => {
            const key = entityName.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
            const ent = await db.select().from(schema.entities)
              .where(eq(schema.entities.normalizedKey, key)).limit(1).then(r => r[0] ?? null);
            if (!ent) return `エンティティ「${entityName}」は知識グラフ未登録`;
            const [benches, claims, rels] = await Promise.all([
              db.select({ b: schema.benchmarks.benchmarkName, s: schema.benchmarks.score, d: schema.benchmarks.recordedDate })
                .from(schema.benchmarks).where(eq(schema.benchmarks.entityId, ent.id))
                .orderBy(desc(schema.benchmarks.recordedDate)).limit(5),
              db.select({ p: schema.claims.predicate, v: schema.claims.value, cs: schema.claims.confidenceScore, d: schema.claims.validFrom })
                .from(schema.claims).where(and(eq(schema.claims.entityId, ent.id), eq(schema.claims.status, 'active')))
                .orderBy(desc(schema.claims.validFrom)).limit(6),
              db.select({ t: schema.relations.relationType, o: schema.relations.objectName })
                .from(schema.relations).where(and(eq(schema.relations.subjectEntityId, ent.id), eq(schema.relations.status, 'active'))).limit(4),
            ]);
            let out = `■ ${ent.canonicalName} (${ent.type ?? 'model'}) | mention:${ent.mentionCount}`;
            for (const b of benches) out += `\n  [bench] ${b.b}: ${b.s} (${b.d ?? '日付不明'})`;
            for (const c of claims) out += `\n  [claim] ${c.p}: ${c.v} (確信度${Number(c.cs ?? 0.7).toFixed(2)}, ${c.d ?? '?'})`;
            for (const r of rels) out += `\n  [rel] ${r.t} → ${r.o}`;
            return out;
          },
        }),
        get_topic_coverage: tool({
          description: '今週のカテゴリ別カバレッジと先週比を取得する（薄いカテゴリを特定するため）',
          inputSchema: z.object({}),
          execute: async () => {
            const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
            const [thisW, prevW] = await Promise.all([
              db.select({ cat: schema.collectedData.category, c: count() })
                .from(schema.collectedData).where(gte(schema.collectedData.createdAt, oneWeekAgo))
                .groupBy(schema.collectedData.category),
              db.select({ cat: schema.collectedData.category, c: count() })
                .from(schema.collectedData).where(and(gte(schema.collectedData.createdAt, twoWeeksAgo), lt(schema.collectedData.createdAt, oneWeekAgo)))
                .groupBy(schema.collectedData.category),
            ]);
            const prev = new Map(prevW.map(r => [r.cat, Number(r.c)]));
            return thisW.map(r => {
              const p = prev.get(r.cat) ?? 0;
              const diff = p > 0 ? `(先週比${Number(r.c) > p ? '+' : ''}${Number(r.c) - p})` : '(先週なし)';
              return `${r.cat ?? '未分類'}: ${r.c}件 ${diff}`;
            }).join('\n') || 'データなし';
          },
        }),
        get_recent_alerts: tool({
          description: '最近のアクティブなアラートを取得する（追跡中の変化・裏取りが必要な情報）',
          inputSchema: z.object({}),
          execute: async () => {
            const alerts = await db.select({ title: schema.alerts.title, type: schema.alerts.type, severity: schema.alerts.severity })
              .from(schema.alerts).where(eq(schema.alerts.status, 'active'))
              .orderBy(desc(schema.alerts.createdAt)).limit(8);
            return alerts.map(a => `[${a.severity ?? 'watch'}/${a.type}] ${a.title}`).join('\n') || 'アクティブなアラートなし';
          },
        }),
        check_corpus_coverage: tool({
          description: 'あるトピックが収集コーパスで既に充分カバーされているかを確認する（問いを重複させないため）',
          inputSchema: z.object({ topic: z.string().max(200) }),
          execute: async ({ topic }) => {
            const { hybridSearch } = await import('./src/lib/retrieval');
            const docs = await hybridSearch(topic, 4);
            if (docs.length === 0) return `「${topic}」: コーパスにほぼ情報なし → 調査価値高`;
            const titles = docs.map(d => `  [重要度${d.importance}] ${d.titleJa || d.title}`).join('\n');
            return `「${topic}」: ${docs.length}件の関連記事あり\n${titles}`;
          },
        }),
      },
    }));

    const parsed = extractJson<{ questions: Array<{ question: string; origin: string; rationale: string }> }>(text);
    if (!parsed?.questions?.length) {
      console.log('[Research] エージェントが問いを生成しなかった');
      return;
    }

    let generated = 0;
    for (const q of parsed.questions) {
      const norm = q.question.trim().toLowerCase();
      if (!norm || existingSet.has(norm)) continue;
      existingSet.add(norm);
      await db.insert(schema.researchQuestions).values({
        question: q.question.trim(),
        origin: (q.origin ?? 'gap') as any,
        originRef: (q.rationale ?? '').slice(0, 150),
        status: 'pending',
      });
      generated++;
    }
    console.log(`[Research] エージェント問い生成: ${generated}件`);
  } catch (e: any) {
    console.warn('[Research] エージェント問い生成失敗(非クリティカル):', e.message?.slice(0, 80));
  }
}

// ── v3: 夜間Grounding調査（保留中の問いを調べる。件数を上限化）────────
async function runNightlyResearch(limit = 4) {
  console.log('[Research] 夜間調査開始（自前コーパスRAG・外部検索なし）');
  const pending = await db.select({ id: schema.researchQuestions.id, question: schema.researchQuestions.question })
    .from(schema.researchQuestions)
    .where(eq(schema.researchQuestions.status, 'pending'))
    .orderBy(desc(schema.researchQuestions.createdAt))
    .limit(limit);

  if (pending.length === 0) { console.log('[Research] 調査対象なし'); return; }

  // env ロード後に動的import（retrieval.ts内の@/dbクライアントが環境変数を参照するため）
  const { hybridSearch } = await import('./src/lib/retrieval');
  let investigated = 0;

  for (const q of pending) {
    try {
      const docs = await hybridSearch(q.question, 8);
      if (docs.length === 0) {
        await db.update(schema.researchQuestions)
          .set({ status: 'investigated', findings: '収集データには該当する情報が見つかりませんでした。', findingsUrl: null, investigatedAt: new Date().toISOString() })
          .where(eq(schema.researchQuestions.id, q.id));
        investigated++;
        continue;
      }
      const ctx = docs.map(d => `[ID:${d.id}] ${d.titleJa || d.title || ''}: ${d.summary ?? ''}${d.snippet ? `\n抜粋: ${d.snippet}` : ''}`).join('\n\n');
      const result = await withRetry(() => generateText({
        model: google('gemini-2.5-flash-lite'),
        system: `あなたはAI技術リサーチャーです。**以下の収集コーパスのみ**を根拠に、問いへ日本語250文字程度で簡潔に答えてください。
コーパスに無い事実は推測で補わず「収集データには見当たらない」と述べること。`,
        prompt: `問い: ${q.question}\n\n【収集コーパス】\n${ctx}`,
      }));
      const findings = result.text.trim().slice(0, 800);
      await db.update(schema.researchQuestions)
        .set({ status: 'investigated', findings, findingsUrl: docs[0].url ?? null, investigatedAt: new Date().toISOString() })
        .where(eq(schema.researchQuestions.id, q.id));
      investigated++;
      console.log(`  調査完了: ${q.question.slice(0, 50)}`);
    } catch (e: any) {
      await db.update(schema.researchQuestions)
        .set({ status: 'failed', investigatedAt: new Date().toISOString() })
        .where(eq(schema.researchQuestions.id, q.id));
      console.warn(`  調査失敗: ${q.question.slice(0, 40)} - ${e.message?.slice(0, 40)}`);
    }
  }
  console.log(`[Research] ${investigated}件調査完了（コーパス根拠）`);
}

// ── v3: 朝のブリーフィング合成（昨夜調べたこと + アラート）──────────────
async function generateBriefing(): Promise<string | null> {
  try {
    console.log('[Briefing] ブリーフィング合成開始');
    const since1dISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const since2dISO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const [investigated, activeAlerts, flashItems] = await Promise.all([
      db.select({
        question: schema.researchQuestions.question,
        findings: schema.researchQuestions.findings,
        findingsUrl: schema.researchQuestions.findingsUrl,
      })
        .from(schema.researchQuestions)
        .where(and(eq(schema.researchQuestions.status, 'investigated'), gte(schema.researchQuestions.investigatedAt, since1dISO)))
        .limit(6),
      db.select({ title: schema.alerts.title, reason: schema.alerts.reason, severity: schema.alerts.severity })
        .from(schema.alerts)
        .where(eq(schema.alerts.status, 'active'))
        .orderBy(desc(schema.alerts.createdAt))
        .limit(6),
      // Morning Flash: 直近の重要記事トップ5（1行ずつ・30秒で読める）
      db.select({
        title: schema.collectedData.title,
        titleJa: schema.collectedData.titleJa,
        category: schema.collectedData.category,
        importanceScore: schema.collectedData.importanceScore,
      })
        .from(schema.collectedData)
        .where(gte(schema.collectedData.createdAt, since2dISO))
        .orderBy(desc(schema.collectedData.importanceScore), desc(schema.collectedData.createdAt))
        .limit(5),
    ]);

    if (investigated.length === 0 && activeAlerts.length === 0 && flashItems.length === 0) {
      console.log('[Briefing] 材料なし、スキップ');
      return null;
    }

    const sevMark: Record<string, string> = { high: '🔴', watch: '🟡', info: '🔵' };
    let md = '## 🌅 朝のブリーフィング\n\n';

    // Morning Flash（重要5件・各1行）
    if (flashItems.length > 0) {
      md += '### ⚡ Morning Flash（今日の重要5件）\n';
      for (const f of flashItems) {
        md += `- [重要度${f.importanceScore ?? '-'}/${f.category ?? '—'}] ${f.titleJa || f.title}\n`;
      }
      md += '\n';
    }

    if (activeAlerts.length > 0) {
      md += '### 🔔 先読みアラート\n';
      for (const a of activeAlerts) {
        md += `- ${sevMark[a.severity ?? 'watch'] ?? '🟡'} **${a.title}** — ${a.reason}\n`;
      }
      md += '\n';
    }

    if (investigated.length > 0) {
      md += '### 🔬 昨夜調べたこと\n';
      for (const r of investigated) {
        md += `- **${r.question}**\n  ${(r.findings ?? '').replace(/\n+/g, ' ')}${r.findingsUrl ? `\n  → ${r.findingsUrl}` : ''}\n`;
      }
      md += '\n';
    }

    const reportDateJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    await db.insert(schema.reports).values({ type: 'briefing', content: md, reportDate: reportDateJST });
    console.log('[Briefing] ブリーフィング合成完了');
    return md;
  } catch (e: any) {
    console.warn('[Briefing] 合成失敗(非クリティカル):', e.message?.slice(0, 60));
    return null;
  }
}

// ── v3.1 スマートダイジェスト: Learning Recap（今週の学びの振り返り・パーソナル）──
async function generateLearningRecap(): Promise<string | null> {
  try {
    console.log('[Recap] 学びの振り返り生成開始');
    const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentEvents = await db.select({ articleId: schema.readingEvents.articleId })
      .from(schema.readingEvents)
      .where(gte(schema.readingEvents.createdAt, sevenAgo))
      .limit(80);
    const ids = [...new Set(recentEvents.map(e => e.articleId).filter((v): v is number => v != null))];
    if (ids.length < 3) { console.log('[Recap] 今週のエンゲージメント不足、スキップ'); return null; }

    const articles = await db.select({
      title: schema.collectedData.title, titleJa: schema.collectedData.titleJa,
      summary: schema.collectedData.summary, category: schema.collectedData.category,
    }).from(schema.collectedData).where(inArray(schema.collectedData.id, ids)).limit(30);

    const ctx = articles.map(a => `[${a.category ?? '—'}] ${a.titleJa || a.title}: ${(a.summary ?? '').slice(0, 120)}`).join('\n');
    const { text } = await withRetry(() => generateText({
      model: google('gemini-2.5-flash'),
      system: `あなたはパーソナル学習コーチです。ユーザーが今週読んだ記事から「今週の学びの振り返り」をMarkdownで温かく簡潔に作成してください。
【構成】
## 📚 今週のあなたの学び
今週触れたテーマの要点を2〜3段落で物語的に。
## 🎯 押さえた重要ポイント
箇条書き3〜5点。
## 🌱 来週深めると良いこと
読んだ傾向から、次に学ぶと視野が広がるテーマを2〜3点提案。
【ルール】全体800〜1000字。専門用語は噛み砕く。`,
      prompt: `今週ユーザーが読んだ記事（${articles.length}件）:\n${ctx}`,
    }));

    const reportDateJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    await db.insert(schema.reports).values({ type: 'learning_recap', content: text, reportDate: reportDateJST });
    console.log('[Recap] 学びの振り返り生成完了');
    return text;
  } catch (e: any) {
    console.warn('[Recap] 生成失敗(非クリティカル):', e.message?.slice(0, 60));
    return null;
  }
}

// ── v3.2 横断インサイト: 知識グラフ×収集×行動を統合した週次考察 ──
async function generateCrossInsight(): Promise<string | null> {
  try {
    console.log('[CrossInsight] 横断インサイト生成開始');

    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const check = await db.select({ c: count() }).from(schema.collectedData).where(gte(schema.collectedData.createdAt, since7));
    if (Number(check[0].c) < 3) { console.log('[CrossInsight] データ不足、スキップ'); return null; }

    const { askKnowledgeAI } = await import('./src/lib/knowledge-ai');
    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });

    const text = await withRetry(() => askKnowledgeAI(
      `今日は${today}です。今週の収集データ・知識グラフ・アラート・読書パターンを横断的に分析し、以下の構成でMarkdownを書いてください。

ツールの使い方:
- get_recent_articles(days=7, minImportance=5) で今週の主要トピックを取得
- get_knowledge_graph_summary() で知識グラフの関係・変化を取得
- get_alerts() で先読みアラートを取得
- get_reading_patterns(days=7) で読者の関心分野を把握しトーンに反映

## 🔭 今週の構図
業界全体で何が起きているかを俯瞰（2〜3段落）。トピック間のつながり・因果を読む。

## 🎯 あなたにとっての意味
読書パターンの関心分野を踏まえ、特に注目すべき点と理由。

## ♟️ 次の一手
来週意識すべきこと・確認すべきことを2〜3点。

【ルール】1000〜1400字。表面的な要約でなく「つながり」と「示唆」を述べる。`,
      { model: 'gemini-2.5-flash', maxSteps: 5 },
    ));

    const reportDateJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    await db.insert(schema.reports).values({ type: 'cross_insight', content: text, reportDate: reportDateJST });
    console.log('[CrossInsight] 生成完了');
    return text;
  } catch (e: any) {
    console.warn('[CrossInsight] 失敗(非クリティカル):', e.message?.slice(0, 60));
    return null;
  }
}

async function evolveSources() {
  console.log('[Evolve] ソース進化開始');

  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const allSources = await db.select().from(schema.sources)
    .where(sql`${schema.sources.status} != 'stopped'`);

  const qualityStats = await db.select({
    sourceId: schema.collectedData.sourceId,
    avg: sql<number>`COALESCE(AVG(${schema.collectedData.importanceScore}), 5)`,
    max: sql<number>`COALESCE(MAX(${schema.collectedData.importanceScore}), 5)`,
  })
    .from(schema.collectedData)
    .where(gte(schema.collectedData.createdAt, fourteenDaysAgo))
    .groupBy(schema.collectedData.sourceId);
  const avgImportanceMap = new Map(qualityStats.map(a => [a.sourceId, Number(a.avg)]));
  const maxImportanceMap = new Map(qualityStats.map(a => [a.sourceId, Number(a.max)]));

  const hitCounts = await db.select({
    sourceId: schema.collectedData.sourceId,
    cnt: count(),
  })
    .from(schema.collectedData)
    .where(gte(schema.collectedData.createdAt, fourteenDaysAgo))
    .groupBy(schema.collectedData.sourceId);
  const hitCountMap = new Map(hitCounts.map(h => [h.sourceId, Number(h.cnt)]));

  const adoptionCounts = await db.select({
    sourceId: schema.adoptionLogs.sourceId,
    cnt: count(),
  })
    .from(schema.adoptionLogs)
    .where(and(eq(schema.adoptionLogs.isAdopted, 1), gte(schema.adoptionLogs.createdAt, thirtyDaysAgo)))
    .groupBy(schema.adoptionLogs.sourceId);
  const adoptionCountMap = new Map(adoptionCounts.map(a => [a.sourceId, Number(a.cnt)]));

  const lastAdoptions = await db.select({
    sourceId: schema.adoptionLogs.sourceId,
    lastAt: sql<string>`MAX(${schema.adoptionLogs.createdAt})`,
  })
    .from(schema.adoptionLogs)
    .where(eq(schema.adoptionLogs.isAdopted, 1))
    .groupBy(schema.adoptionLogs.sourceId);
  const lastAdoptionMap = new Map(lastAdoptions.map(a => [a.sourceId, a.lastAt]));

  let promoted = 0, demoted = 0, reactivated = 0, stoppedCount = 0;
  const updates: Array<{ id: number; status: string; score: number }> = [];

  for (const source of allSources) {
    // RSS/HN/ArXiv/GitHubTrending/PwC型は常にactiveを維持（自動停止しない）
    if (['rss', 'hn', 'arxiv', 'github-trending', 'pwc'].includes(source.type ?? '')) continue;

    const daysSinceCreated = (now.getTime() - new Date(source.createdAt ?? now).getTime()) / 86400000;
    const hitCount14d = hitCountMap.get(source.id) ?? 0;
    const lastAdoptedAt = lastAdoptionMap.get(source.id);
    const daysSinceAdopted = lastAdoptedAt
      ? (now.getTime() - new Date(lastAdoptedAt).getTime()) / 86400000
      : Infinity;

    const avgImportance = avgImportanceMap.get(source.id) ?? 5;
    const maxImportance = maxImportanceMap.get(source.id) ?? avgImportance;
    const adoptionCount = adoptionCountMap.get(source.id) ?? 0;
    const qualityBase = avgImportance * 0.6 + maxImportance * 0.4;
    const newScore = Math.round(qualityBase * (1 + adoptionCount * 0.5) * 10) / 10;

    let newStatus: string = source.status ?? 'candidate';

    // 低品質間引き: 十分ヒットしているのに平均重要度が低く採用ゼロ → グラウンディング予算の無駄なので停止
    const lowQuality = hitCount14d >= 4 && avgImportance < 4 && adoptionCount === 0;

    if (source.status === 'candidate') {
      if (lowQuality) {
        newStatus = 'stopped'; stoppedCount++;
      } else if (hitCount14d >= 3 && lastAdoptedAt) {
        newStatus = 'active'; promoted++;
      } else if (daysSinceCreated >= 14) {
        newStatus = 'stopped'; stoppedCount++;
      }
    } else if (source.status === 'active') {
      if (lowQuality) { newStatus = 'low-priority'; demoted++; }
      else if (daysSinceAdopted >= 14) { newStatus = 'low-priority'; demoted++; }
    } else if (source.status === 'low-priority') {
      if (lowQuality && daysSinceCreated >= 21) { newStatus = 'stopped'; stoppedCount++; }
      else if (daysSinceAdopted < 14) { newStatus = 'active'; reactivated++;
      } else if (daysSinceAdopted >= 30) { newStatus = 'stopped'; stoppedCount++; }
    }

    if (newStatus !== source.status || newScore !== (source.score ?? 0)) {
      updates.push({ id: source.id, status: newStatus, score: newScore });
    }
  }

  const evolveUpdatedAt = new Date().toISOString();
  for (const u of updates) {
    await db.update(schema.sources)
      .set({ status: u.status, score: u.score, updatedAt: evolveUpdatedAt })
      .where(eq(schema.sources.id, u.id));
  }

  console.log(`[Evolve] 昇格${promoted}, 降格${demoted}, 再活性化${reactivated}, 停止${stoppedCount}`);

  const highQualityData = await db.select({
    summary: schema.collectedData.summary,
    title: schema.collectedData.title,
    importanceScore: schema.collectedData.importanceScore,
  })
    .from(schema.collectedData)
    .where(and(
      gte(schema.collectedData.createdAt, fourteenDaysAgo),
      gte(schema.collectedData.importanceScore, 6),
    ))
    .orderBy(desc(schema.collectedData.importanceScore))
    .limit(15);

  if (highQualityData.length === 0) {
    console.log('[Evolve] 高品質記事なし、キーワード発見スキップ');
    return;
  }

  const allSourceValues = await db.select({ value: schema.sources.value }).from(schema.sources);
  const existingLower = new Set(allSourceValues.map(s => s.value.toLowerCase()));

  const contextText = highQualityData
    .map(d => `[重要度:${d.importanceScore}] ${d.title ?? ''}: ${d.summary ?? ''}`)
    .join('\n');
  const allText = highQualityData
    .map(d => `${d.title ?? ''} ${d.summary ?? ''}`)
    .join(' ')
    .toLowerCase();

  try {
    const { object: kwObject } = await withRetry(() => generateObject({
      model: google('gemini-2.5-flash-lite'),
      schema: KeywordsSchema,
      prompt: `以下の高品質AI記事（重要度7以上）から、追跡すべき具体的なAI技術キーワードを最大5つ抽出してください。

【抽出条件】
- 特定のモデル名・アーキテクチャ名・手法名・ツール名・フレームワーク名のみ
- 「AI」「LLM」「機械学習」「モデル」「研究」「技術」などの汎用語は含めない
- 固有名詞・略語・製品名を優先（例: Mamba, FlashAttention, LoRA, Phi-4, GRPO）
- 正式名称・最も一般的な表記で統一する

【記事】
${contextText}`,
    }));

    const rawKws: string[] = kwObject.keywords;
    let added = 0;
    const addedThisRound = new Set<string>();

    for (const kw of rawKws) {
      const trimmed = kw.trim();
      if (!trimmed || trimmed.length < 3 || trimmed.length > 60) continue;
      if (KW_STOPWORDS.has(trimmed)) continue;

      const kwLower = trimmed.toLowerCase();
      if (existingLower.has(kwLower)) continue;
      if (addedThisRound.has(kwLower)) continue;

      const escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const freq = (allText.match(new RegExp(escaped, 'g')) ?? []).length;
      const initialScore = Math.min(10, freq * 1.5);

      const kwInsertRes = await db.insert(schema.sources)
        .values({ type: 'keyword', value: trimmed, status: 'candidate', score: initialScore })
        .onConflictDoNothing();
      if (kwInsertRes.rowsAffected > 0) {
        added++;
        addedThisRound.add(kwLower);
        existingLower.add(kwLower);
      }
    }
    console.log(`[Evolve] 新規候補${added}件追加`);
  } catch (e: any) {
    console.warn('[Evolve] キーワード発見失敗(非クリティカル):', e.message);
  }

  // v4: 高品質記事のドメインを「無料フィード」として収穫（検索の卒業エンジン）。
  // 検索が拾った良質ドメインのRSS/Atomを自動発見し、以後は無料で巡回する。
  try {
    const candRows = await db.select({ url: schema.collectedData.url })
      .from(schema.collectedData)
      .where(and(
        gte(schema.collectedData.createdAt, fourteenDaysAgo),
        gte(schema.collectedData.importanceScore, 8),
      ))
      .orderBy(desc(schema.collectedData.importanceScore))
      .limit(60);

    // 既に巡回中のドメイン（フィードURLからhostnameを抽出）
    const feedHosts = new Set<string>();
    for (const { value } of allSourceValues) {
      try { if (value.startsWith('http')) feedHosts.add(new URL(value).hostname.replace(/^www\./, '')); } catch { }
    }

    const seen = new Set<string>();
    const newDomains: string[] = [];
    for (const { url } of candRows) {
      if (!url) continue;
      try {
        const h = new URL(url).hostname.replace(/^www\./, '');
        if (DOMAIN_SKIP.has(h) || feedHosts.has(h) || seen.has(h)) continue;
        seen.add(h);
        newDomains.push(h);
      } catch { }
    }

    let feedsAdded = 0;
    for (const domain of newDomains.slice(0, 8)) { // 1実行あたり最大8ドメインを探索（時間制御）
      const feedUrl = await discoverFeedUrl(domain);
      if (!feedUrl) continue;
      const r = await db.insert(schema.sources)
        .values({ type: 'rss', value: feedUrl, status: 'active', score: 3 })
        .onConflictDoNothing();
      if (r.rowsAffected > 0) {
        feedsAdded++;
        feedHosts.add(domain);
        console.log(`[Evolve] フィード発見: ${domain} → ${feedUrl}`);
      }
    }
    if (feedsAdded > 0) console.log(`[Evolve] 無料フィード自動登録: ${feedsAdded}件`);
  } catch (e: any) {
    console.warn('[Evolve] フィード自動発見失敗(非クリティカル):', e.message);
  }

  // ── 改善2: 重要度スコアの相対化（30日分のパーセンタイル正規化）────────
  try {
    const thirtyDaysAgoISO = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const allScores = await db.select({
      id: schema.collectedData.id,
      score: schema.collectedData.importanceScore,
      storyCount: schema.collectedData.storyCount,
    })
      .from(schema.collectedData)
      .where(gte(schema.collectedData.createdAt, thirtyDaysAgoISO));

    if (allScores.length >= 10) {
      const sorted = allScores.map(r => r.score ?? 5).sort((a, b) => a - b);
      const n = sorted.length;
      // 各スコア値（0-10）→ パーセンタイル正規化(1-10)
      const pct = new Map<number, number>();
      for (let s = 0; s <= 10; s++) {
        const rank = sorted.filter(x => x <= s).length;
        pct.set(s, Math.max(1, Math.min(10, Math.round((rank / n) * 9) + 1)));
      }
      // corroboration合成: 何媒体が独立に報じたか(story_count)で加点。冪等(rawから毎回再計算)
      const corrob = (c: number) => (c >= 5 ? 3 : c >= 3 ? 2 : c >= 2 ? 1 : 0);
      // 最終正規化値ごとに記事IDをまとめて一括UPDATE
      const byTarget = new Map<number, number[]>();
      for (const r of allScores) {
        const base = pct.get(r.score ?? 5) ?? 5;
        const target = Math.max(1, Math.min(10, base + corrob(r.storyCount ?? 1)));
        const arr = byTarget.get(target) ?? [];
        arr.push(r.id);
        byTarget.set(target, arr);
      }
      for (const [target, ids] of byTarget) {
        for (let i = 0; i < ids.length; i += 200) {
          await db.update(schema.collectedData)
            .set({ normalizedImportanceScore: target })
            .where(inArray(schema.collectedData.id, ids.slice(i, i + 200)));
        }
      }
      console.log(`[Evolve] スコア正規化(corroboration合成): ${n}件処理`);
    }
  } catch (e: any) {
    console.warn('[Evolve] スコア正規化失敗(非クリティカル):', e.message);
  }

  // ── 改善3: カバレッジギャップ検出と能動的補完 ────────────────────────
  try {
    const CAT_GAP_KEYWORDS: Record<string, string[]> = {
      'LLM推論':              ['speculative decoding', 'vLLM optimization', 'inference benchmark'],
      'エージェント':          ['AI agent framework', 'multi-agent LLM', 'autonomous AI workflow'],
      'ツール/フレームワーク': ['LangChain update', 'Hugging Face PEFT', 'model fine-tuning'],
      'ハードウェア':          ['NVIDIA AI chip', 'AI accelerator benchmark', 'TPU ML performance'],
      'ビジネス応用':          ['enterprise LLM deployment', 'AI cost reduction', 'AI compliance'],
      '研究/論文':             ['NeurIPS 2025 paper', 'AI alignment research', 'ICLR 2025'],
    };
    const oneWeekAgoISO = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourWeeksAgoISO = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString();

    const [historicalCounts, thisWeekCounts] = await Promise.all([
      db.select({ category: schema.collectedData.category, cnt: count() })
        .from(schema.collectedData)
        .where(and(gte(schema.collectedData.createdAt, fourWeeksAgoISO), lt(schema.collectedData.createdAt, oneWeekAgoISO)))
        .groupBy(schema.collectedData.category),
      db.select({ category: schema.collectedData.category, cnt: count() })
        .from(schema.collectedData)
        .where(gte(schema.collectedData.createdAt, oneWeekAgoISO))
        .groupBy(schema.collectedData.category),
    ]);

    const historicalAvg = new Map(historicalCounts.map(r => [r.category, Number(r.cnt) / 3]));
    const thisWeek = new Map(thisWeekCounts.map(r => [r.category, Number(r.cnt)]));
    let gapCount = 0;

    for (const [cat, keywords] of Object.entries(CAT_GAP_KEYWORDS)) {
      const avg = historicalAvg.get(cat) ?? 0;
      const current = thisWeek.get(cat) ?? 0;
      if (avg >= 3 && current < avg * 0.4) {
        console.log(`[Evolve] ギャップ検出: ${cat} (期待${avg.toFixed(1)}/週 → 実績${current})`);
        for (const kw of keywords.slice(0, 2)) {
          const kwLower = kw.toLowerCase();
          if (existingLower.has(kwLower)) continue;
          const r = await db.insert(schema.sources)
            .values({ type: 'keyword', value: kw, status: 'candidate', score: 2 })
            .onConflictDoNothing();
          if (r.rowsAffected > 0) { gapCount++; existingLower.add(kwLower); }
        }
      }
    }
    if (gapCount > 0) console.log(`[Evolve] カバレッジギャップ補完: ${gapCount}件追加`);
  } catch (e: any) {
    console.warn('[Evolve] カバレッジギャップ検出失敗(非クリティカル):', e.message);
  }
}

// ── v3: 埋め込み生成（embeddingはDrizzle非管理のため生SQL）────────────
const EMBED_DIM = 768;
const EMBED_BATCH = 50;
// v4.5: RAG非対称埋め込み。文書側はRETRIEVAL_DOCUMENT（クエリ側はretrieval.tsでRETRIEVAL_QUERY）
const EMBED_TASK_DOC = 'RETRIEVAL_DOCUMENT';

async function runEmbeddings(limit = 120): Promise<number> {
  console.log('[Embed] 埋め込み生成開始');
  const res = await client.execute({
    sql: `SELECT id, title, summary FROM collected_data WHERE embedding IS NULL ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  const rows = res.rows.map(r => ({
    id: Number(r.id),
    title: (r.title as string | null) ?? '',
    summary: (r.summary as string | null) ?? '',
  }));
  if (rows.length === 0) { console.log('[Embed] 対象なし'); return 0; }

  let embedded = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const chunk = rows.slice(i, i + EMBED_BATCH);
    const values = chunk.map(r => (`${r.title}\n${r.summary.slice(0, 1500)}`).trim() || 'untitled');
    try {
      const { embeddings } = await withRetry(() => embedMany({
        model: google.embedding('gemini-embedding-001'),
        values,
        providerOptions: { google: { outputDimensionality: EMBED_DIM, taskType: EMBED_TASK_DOC } },
      }));
      for (let j = 0; j < chunk.length; j++) {
        const vec = embeddings[j];
        if (!vec || vec.length !== EMBED_DIM) continue;
        await client.execute({
          sql: `UPDATE collected_data SET embedding = vector32(?) WHERE id = ?`,
          args: [JSON.stringify(vec), chunk[j].id],
        });
        embedded++;
      }
    } catch (e: any) {
      console.warn(`  [Embed] バッチ失敗(非クリティカル): ${(e.message ?? '').slice(0, 80)}`);
    }
  }
  console.log(`[Embed] ${embedded}件ベクトル化`);
  return embedded;
}

// v4.5-A: 本文をチャンク分割して埋め込む（パッセージレベルRAG）。
function chunkText(text: string, size = 1500, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < 8) { // 最大8チャンク/記事（コスト制御）
    chunks.push(clean.slice(start, start + size));
    start += size - overlap;
  }
  return chunks;
}

async function runChunkEmbeddings(limit = 40): Promise<number> {
  console.log('[Chunk] チャンク埋め込み生成開始');
  const res = await client.execute({
    sql: `SELECT id, raw_content FROM collected_data
          WHERE raw_content IS NOT NULL
            AND importance_score >= 7
            AND id NOT IN (SELECT DISTINCT article_id FROM content_chunks)
          ORDER BY importance_score DESC, created_at DESC LIMIT ?`,
    args: [limit],
  });
  const arts = res.rows.map(r => ({ id: Number(r.id), raw: String(r.raw_content ?? '') }));
  if (arts.length === 0) { console.log('[Chunk] 対象なし'); return 0; }

  let total = 0;
  for (const a of arts) {
    const chunks = chunkText(a.raw);
    if (chunks.length === 0) continue;
    try {
      const { embeddings } = await withRetry(() => embedMany({
        model: google.embedding('gemini-embedding-001'),
        values: chunks,
        providerOptions: { google: { outputDimensionality: EMBED_DIM, taskType: EMBED_TASK_DOC } },
      }));
      for (let i = 0; i < chunks.length; i++) {
        const vec = embeddings[i];
        if (!vec || vec.length !== EMBED_DIM) continue;
        await client.execute({
          sql: `INSERT INTO content_chunks (article_id, chunk_index, text, embedding) VALUES (?, ?, ?, vector32(?))`,
          args: [a.id, i, chunks[i], JSON.stringify(vec)],
        });
        total++;
      }
    } catch (e: any) {
      console.warn(`  [Chunk] 失敗(非クリティカル) art=${a.id}: ${(e.message ?? '').slice(0, 60)}`);
    }
  }
  console.log(`[Chunk] ${arts.length}記事 → ${total}チャンク埋め込み`);
  return total;
}

// ── v3: 意味的重複排除（同一ストーリーをstory_idでグループ化）──────────
const STORY_DISTANCE_THRESHOLD = 0.12; // cos距離(=1-類似度)。これ未満を同一ストーリーとみなす
const STORY_LINK_WINDOW_DAYS = 21;

async function recomputeStoryCount(storyId: number) {
  await client.execute({
    sql: `UPDATE collected_data SET story_count = (
            SELECT COUNT(*) FROM collected_data WHERE story_id = ?
          ) WHERE story_id = ?`,
    args: [storyId, storyId],
  });
}

async function runStoryGrouping(limit = 150): Promise<{ stories: number; merged: number }> {
  console.log('[Story] 意味的重複排除（ストーリーグループ化）開始');
  const cutoff = new Date(Date.now() - STORY_LINK_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const targetRes = await client.execute({
    sql: `SELECT id FROM collected_data
          WHERE embedding IS NOT NULL AND story_id IS NULL
          ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  const targetIds = targetRes.rows.map(r => Number(r.id));
  if (targetIds.length === 0) { console.log('[Story] 対象なし'); return { stories: 0, merged: 0 }; }

  const assigned = new Set<number>(); // このラウンドで割当済みのid
  const touchedStories = new Set<number>();
  let merged = 0, newStories = 0;

  for (const aid of targetIds) {
    if (assigned.has(aid)) continue;

    // 対象記事のベクトルを取り出す
    const embRes = await client.execute({
      sql: `SELECT vector_extract(embedding) AS emb FROM collected_data WHERE id = ?`,
      args: [aid],
    });
    const embStr = embRes.rows[0]?.emb as string | undefined;
    if (!embStr) continue;

    // 近傍検索（自身を除く・直近ウィンドウ内・閾値内）
    const nnRes = await client.execute({
      sql: `SELECT t.id AS id, t.story_id AS story_id,
                   vector_distance_cos(t.embedding, vector32(?)) AS dist
            FROM vector_top_k('collected_embedding_idx', vector32(?), 12) AS v
            JOIN collected_data t ON t.rowid = v.id
            WHERE t.id != ? AND t.created_at >= ?
            ORDER BY dist ASC`,
      args: [embStr, embStr, aid, cutoff],
    });
    const neighbors = nnRes.rows
      .map(r => ({ id: Number(r.id), storyId: r.story_id == null ? null : Number(r.story_id), dist: Number(r.dist) }))
      .filter(n => n.dist < STORY_DISTANCE_THRESHOLD);

    if (neighbors.length === 0) {
      // 単独ストーリー（自分が代表）
      await client.execute({ sql: `UPDATE collected_data SET story_id = ?, story_count = 1 WHERE id = ?`, args: [aid, aid] });
      assigned.add(aid);
      newStories++;
      continue;
    }

    // 既存ストーリーに属する近傍があれば最も近いものに合流
    const withStory = neighbors.filter(n => n.storyId != null);
    if (withStory.length > 0) {
      const storyId = withStory[0].storyId as number; // dist昇順なので先頭が最近傍
      await client.execute({ sql: `UPDATE collected_data SET story_id = ? WHERE id = ?`, args: [storyId, aid] });
      assigned.add(aid);
      touchedStories.add(storyId);
      merged++;
    } else {
      // 近傍はあるが全員未割当 → 新ストーリーを作る。代表は最古(=最小id)
      const clusterIds = [aid, ...neighbors.map(n => n.id)];
      const canonical = Math.min(...clusterIds);
      for (const cid of clusterIds) {
        await client.execute({ sql: `UPDATE collected_data SET story_id = ? WHERE id = ?`, args: [canonical, cid] });
        assigned.add(cid);
      }
      touchedStories.add(canonical);
      newStories++;
      merged += clusterIds.length - 1;
    }
  }

  // 影響を受けたストーリーのstory_countを再計算
  for (const sid of touchedStories) {
    await recomputeStoryCount(sid);
  }

  console.log(`[Story] 新規ストーリー${newStories}件, 重複統合${merged}件`);
  return { stories: newStories, merged };
}

// ── v3.1: 英語タイトルの日本語訳（サマリーは既に日本語生成済み）──────────
const JA_CHAR = /[ぁ-んァ-ヶ一-龯々〆〤ー]/;
const TitleTransSchema = z.object({
  items: z.array(z.object({ id: z.number().int(), titleJa: z.string().max(300) })),
});

async function translateTitles(limit = 80): Promise<number> {
  console.log('[Translate] タイトル翻訳開始');
  const rows = await db.select({ id: schema.collectedData.id, title: schema.collectedData.title })
    .from(schema.collectedData)
    .where(and(isNull(schema.collectedData.titleJa), sql`${schema.collectedData.title} IS NOT NULL`))
    .orderBy(desc(schema.collectedData.createdAt))
    .limit(limit);

  // 日本語文字を含まない＝翻訳対象（英語等）
  const targets = rows.filter(r => r.title && !JA_CHAR.test(r.title));
  if (targets.length === 0) { console.log('[Translate] 対象なし'); return 0; }

  let translated = 0;
  const BATCH = 25;
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH);
    try {
      const { object } = await withRetry(() => generateObject({
        model: google('gemini-2.5-flash-lite'),
        schema: TitleTransSchema,
        prompt: `以下のタイトルを自然な日本語に訳してください。固有名詞・モデル名・製品名・略語は英語表記のまま残す。必ず全${chunk.length}件のitemsを返す。

${chunk.map(c => `[${c.id}] ${c.title}`).join('\n')}`,
      }));
      for (const it of object.items) {
        if (!it.titleJa) continue;
        await db.update(schema.collectedData)
          .set({ titleJa: it.titleJa.slice(0, 300) })
          .where(eq(schema.collectedData.id, it.id));
        translated++;
      }
    } catch (e: any) {
      console.warn(`  [Translate] バッチ失敗(非クリティカル): ${(e.message ?? '').slice(0, 60)}`);
    }
  }
  console.log(`[Translate] ${translated}件翻訳`);
  return translated;
}

// ── v3.1: 既存クレームの英語predicate/valueを日本語化（「今週の論点」表示用）──
const ClaimsTransSchema = z.object({
  items: z.array(z.object({ id: z.number().int(), predicate: z.string().max(80), value: z.string().max(150) })),
});

async function translateClaims(limit = 200): Promise<number> {
  console.log('[ClaimTrans] クレーム日本語化開始');
  const rows = await db.select({
    id: schema.claims.id, subject: schema.claims.subject,
    predicate: schema.claims.predicate, value: schema.claims.value,
  }).from(schema.claims).orderBy(desc(schema.claims.createdAt)).limit(limit);

  // predicate か value に日本語が無い＝翻訳対象
  const targets = rows.filter(r => !JA_CHAR.test(r.predicate) || !JA_CHAR.test(r.value));
  if (targets.length === 0) { console.log('[ClaimTrans] 対象なし'); return 0; }

  let translated = 0;
  const BATCH = 25;
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH);
    try {
      const { object } = await withRetry(() => generateObject({
        model: google('gemini-2.5-flash-lite'),
        schema: ClaimsTransSchema,
        prompt: `以下のクレームの predicate(述語) と value(値) を自然な日本語に訳してください。固有名詞・モデル名・数値・ベンチマーク名は原語のまま残す。必ず全${chunk.length}件のitemsを返す。

${chunk.map(c => `[${c.id}] subject:${c.subject} / predicate:${c.predicate} / value:${c.value}`).join('\n')}`,
      }));
      for (const it of object.items) {
        if (!it.predicate && !it.value) continue;
        await db.update(schema.claims)
          .set({ predicate: it.predicate.slice(0, 80), value: it.value.slice(0, 150) })
          .where(eq(schema.claims.id, it.id));
        translated++;
      }
    } catch (e: any) {
      console.warn(`  [ClaimTrans] バッチ失敗(非クリティカル): ${(e.message ?? '').slice(0, 60)}`);
    }
  }
  console.log(`[ClaimTrans] ${translated}件日本語化`);
  return translated;
}

// ── v3.1: 既存データのグラウンディングURL(404リダイレクト)を実URLに解決 ──
async function fixGroundingUrls(limit = 300): Promise<void> {
  console.log('[FixURL] 既存リダイレクトURLの解決開始');
  const rows = await db.select({ id: schema.collectedData.id, url: schema.collectedData.url })
    .from(schema.collectedData)
    .where(sql`${schema.collectedData.url} LIKE '%vertexaisearch.cloud.google.com%' OR ${schema.collectedData.url} LIKE '%grounding-api-redirect%'`)
    .limit(limit);
  console.log(`[FixURL] 対象 ${rows.length}件`);

  let fixed = 0, removed = 0;
  for (const r of rows) {
    const resolved = await resolveGroundingUrl(r.url);
    if (resolved && resolved !== r.url) {
      // 解決先URLが既に他記事で使われていたら重複になるため、その場合はnull化
      const dup = await db.select({ id: schema.collectedData.id })
        .from(schema.collectedData)
        .where(and(eq(schema.collectedData.url, resolved), sql`${schema.collectedData.id} != ${r.id}`))
        .limit(1);
      if (dup.length > 0) {
        await db.update(schema.collectedData).set({ url: null }).where(eq(schema.collectedData.id, r.id));
        removed++;
      } else {
        await db.update(schema.collectedData).set({ url: resolved }).where(eq(schema.collectedData.id, r.id));
        fixed++;
      }
    } else {
      // 解決不能なリンクは404の温床なのでnull化
      await db.update(schema.collectedData).set({ url: null }).where(eq(schema.collectedData.id, r.id));
      removed++;
    }
  }
  console.log(`[FixURL] 解決${fixed}件, 除去${removed}件`);
}

// ── v4: 本文ディープ抽出（無料・LLM不使用）────────────────────────────
// 高重要度かつrawContent未取得の直近記事の本文を取得・保存する（RAG/知識抽出の土台）。
async function runDeepExtraction(maxArticles = 25): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.select({ id: schema.collectedData.id, url: schema.collectedData.url })
    .from(schema.collectedData)
    .where(and(
      gte(schema.collectedData.createdAt, sevenDaysAgo),
      gte(schema.collectedData.importanceScore, 8),
      isNull(schema.collectedData.rawContent),
    ))
    .orderBy(desc(schema.collectedData.importanceScore))
    .limit(maxArticles);

  let done = 0;
  for (const r of rows) {
    if (!r.url || /github\.com|vertexaisearch/.test(r.url)) continue; // GitHub等は本文抽出に不向き
    const text = await fetchArticleText(r.url);
    if (!text) continue;
    await db.update(schema.collectedData).set({ rawContent: text }).where(eq(schema.collectedData.id, r.id));
    done++;
  }
  console.log(`[DeepExtract] 本文抽出 ${done}/${rows.length}件`);
}

// ── v4: フィード自己監視（沈黙した自動発見フィードを降格し巡回/評価の無駄を防ぐ）──
// CDATAバグのような「気づかず収量0」を防ぐ安全網。必須/高価値(score>3)は対象外。
async function monitorFeedHealth(): Promise<void> {
  const now = Date.now();
  const cutoff = new Date(now - 21 * 24 * 60 * 60 * 1000).toISOString();

  const lastRows = await db.select({
    sid: schema.collectedData.sourceId,
    last: sql<string>`MAX(${schema.collectedData.createdAt})`,
  }).from(schema.collectedData).groupBy(schema.collectedData.sourceId);
  const lastMap = new Map(lastRows.map(r => [r.sid, r.last]));

  const feeds = await db.select().from(schema.sources)
    .where(and(eq(schema.sources.status, 'active'), eq(schema.sources.type, 'rss' as any)));

  let demoted = 0;
  for (const f of feeds) {
    if ((f.score ?? 0) > 3) continue; // 自動発見フィード(score<=3)のみ対象。必須は守る
    const created = f.createdAt ? new Date(f.createdAt).getTime() : now;
    if (now - created < 21 * 24 * 60 * 60 * 1000) continue; // 登録21日未満は猶予
    const last = lastMap.get(f.id);
    if (last && last >= cutoff) continue; // 直近21日に収量あり
    await db.update(schema.sources).set({ status: 'low-priority' }).where(eq(schema.sources.id, f.id));
    demoted++;
    console.log(`[FeedHealth] 沈黙フィードを降格: ${f.value}`);
  }
  if (demoted > 0) console.log(`[FeedHealth] ${demoted}件降格(自動発見・21日収量0)`);
}

// ── v3.2: 既存データのクリーンアップ（断片関係削除・無効ベンチ削除・ベンチ名正規化）──
async function runDataCleanup(): Promise<void> {
  console.log('[Cleanup] データクリーンアップ開始');

  // 1. 関係: 文の断片（looksLikeEntityを満たさない）を削除
  const rels = await db.select({ id: schema.relations.id, s: schema.relations.subjectName, o: schema.relations.objectName })
    .from(schema.relations);
  const badRel = rels.filter(r => !looksLikeEntity(r.s) || !looksLikeEntity(r.o)).map(r => r.id);
  let relDel = 0;
  for (let i = 0; i < badRel.length; i += 100) {
    const chunk = badRel.slice(i, i + 100);
    if (chunk.length) { await db.delete(schema.relations).where(inArray(schema.relations.id, chunk)); relDel += chunk.length; }
  }

  // 2. ベンチマーク: 無効（スペック等）を削除し、残りの名称を正規化
  const benches = await db.select({ id: schema.benchmarks.id, name: schema.benchmarks.benchmarkName })
    .from(schema.benchmarks);
  const badBench = benches.filter(b => !isValidBenchmarkName(b.name)).map(b => b.id);
  let benchDel = 0;
  for (let i = 0; i < badBench.length; i += 100) {
    const chunk = badBench.slice(i, i + 100);
    if (chunk.length) { await db.delete(schema.benchmarks).where(inArray(schema.benchmarks.id, chunk)); benchDel += chunk.length; }
  }
  let benchNorm = 0;
  for (const b of benches) {
    if (!isValidBenchmarkName(b.name)) continue;
    const canon = canonicalBenchmarkName(b.name);
    if (canon !== b.name) {
      await db.update(schema.benchmarks).set({ benchmarkName: canon }).where(eq(schema.benchmarks.id, b.id));
      benchNorm++;
    }
  }
  console.log(`[Cleanup] 関係削除${relDel}, ベンチ削除${benchDel}, ベンチ名正規化${benchNorm}`);
}

// ── 確信度スペクトル: 日次 decay + stale 移行 + カスケード研究問い生成 ──────────
async function runDecayTick(): Promise<void> {
  console.log('[Decay] 確信度日次更新開始');

  // ベンチマーク・比較系(速い腐敗): ×0.97/day
  await client.execute({
    sql: `UPDATE claims SET confidence_score = MAX(0.0, COALESCE(confidence_score, 0.7) * 0.97)
          WHERE status = 'active'
          AND (predicate LIKE '%score%' OR predicate LIKE '%bench%' OR predicate LIKE '%outperform%'
            OR predicate LIKE '%accuracy%' OR predicate LIKE '%ranking%' OR predicate LIKE '%performance%'
            OR predicate LIKE '%スコア%' OR predicate LIKE '%精度%' OR predicate LIKE '%順位%')`,
    args: [],
  });
  // リリース・発表系(中): ×0.98/day
  await client.execute({
    sql: `UPDATE claims SET confidence_score = MAX(0.0, COALESCE(confidence_score, 0.7) * 0.98)
          WHERE status = 'active'
          AND (predicate LIKE '%releas%' OR predicate LIKE '%launch%' OR predicate LIKE '%announc%'
            OR predicate LIKE '%発表%' OR predicate LIKE '%リリース%' OR predicate LIKE '%公開%')`,
    args: [],
  });
  // その他(遅い腐敗): ×0.995/day
  await client.execute({
    sql: `UPDATE claims SET confidence_score = MAX(0.0, COALESCE(confidence_score, 0.7) * 0.995)
          WHERE status = 'active'
          AND predicate NOT LIKE '%score%' AND predicate NOT LIKE '%bench%'
          AND predicate NOT LIKE '%outperform%' AND predicate NOT LIKE '%accuracy%'
          AND predicate NOT LIKE '%ranking%' AND predicate NOT LIKE '%performance%'
          AND predicate NOT LIKE '%releas%' AND predicate NOT LIKE '%launch%'
          AND predicate NOT LIKE '%announc%' AND predicate NOT LIKE '%発表%'
          AND predicate NOT LIKE '%リリース%' AND predicate NOT LIKE '%公開%'
          AND predicate NOT LIKE '%スコア%' AND predicate NOT LIKE '%精度%'`,
    args: [],
  });

  // 0.25未満 → stale に移行
  const staleRes = await client.execute({
    sql: `UPDATE claims SET status = 'stale' WHERE confidence_score < 0.25 AND status = 'active'`,
    args: [],
  });

  // カスケード: active claimが消えたエンティティ(3件以上mention)を研究キューに登録
  const today = new Date().toISOString().split('T')[0];
  const orphans = await client.execute({
    sql: `SELECT e.id, e.canonical_name FROM entities e
          WHERE e.mention_count >= 3
          AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.entity_id = e.id AND c.status = 'active')
          AND NOT EXISTS (
            SELECT 1 FROM research_questions rq
            WHERE rq.origin = 'confidence_decay' AND rq.origin_ref = CAST(e.id AS TEXT)
            AND rq.status = 'pending' AND rq.created_at >= DATE('now', '-7 days')
          )
          LIMIT 5`,
    args: [],
  });
  let cascadeCount = 0;
  for (const e of orphans.rows as any[]) {
    await db.insert(schema.researchQuestions).values({
      question: `${e.canonical_name}に関する最新情報は何か？確信度が低下したため再確認が必要。`,
      origin: 'confidence_decay',
      originRef: String(e.id),
      status: 'pending',
    }).onConflictDoNothing();
    cascadeCount++;
  }
  console.log(`[Decay] stale=${staleRes.rowsAffected}件 / カスケード問い生成=${cascadeCount}件`);
}

// ── コーパス健全度レポート ─────────────────────────────────────────────
async function runCorpusHealth(): Promise<void> {
  console.log('[Health] コーパス健全度チェック開始');
  const today = new Date().toISOString().split('T')[0];

  const [confStats, entityStats, embedGap, stalestEnts] = await Promise.all([
    client.execute({
      sql: `SELECT COUNT(*) as total,
                   AVG(COALESCE(confidence_score, 0.7)) as avg_conf,
                   SUM(CASE WHEN COALESCE(confidence_score, 0.7) >= 0.7 THEN 1 ELSE 0 END) as healthy,
                   SUM(CASE WHEN COALESCE(confidence_score, 0.7) < 0.3 THEN 1 ELSE 0 END) as at_risk,
                   SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END) as stale_count
            FROM claims`,
      args: [],
    }),
    client.execute({
      sql: `SELECT COUNT(*) as total,
                   SUM(CASE WHEN NOT EXISTS (
                     SELECT 1 FROM claims c WHERE c.entity_id = e.id AND c.status = 'active'
                   ) THEN 1 ELSE 0 END) as orphaned
            FROM entities e WHERE e.mention_count >= 3`,
      args: [],
    }),
    client.execute({
      sql: `SELECT COUNT(*) as total,
                   SUM(CASE WHEN embedding IS NULL THEN 1 ELSE 0 END) as missing_embed
            FROM collected_data
            WHERE created_at >= DATE('now', '-7 days')`,
      args: [],
    }),
    client.execute({
      sql: `SELECT e.canonical_name, AVG(COALESCE(c.confidence_score, 0.7)) as avg_conf
            FROM entities e
            JOIN claims c ON c.entity_id = e.id AND c.status = 'active'
            GROUP BY e.id, e.canonical_name
            HAVING COUNT(c.id) >= 2
            ORDER BY avg_conf ASC LIMIT 5`,
      args: [],
    }),
  ]);

  const cs = confStats.rows[0] as any;
  const es = entityStats.rows[0] as any;
  const eg = embedGap.rows[0] as any;
  const healthScore = Math.round((Number(cs.healthy ?? 0) / Math.max(1, Number(cs.total ?? 1))) * 100);

  const staleEntsText = (stalestEnts.rows as any[]).length > 0
    ? (stalestEnts.rows as any[]).map((r: any) => `- ${r.canonical_name}: 平均確信度 ${Number(r.avg_conf).toFixed(2)}`).join('\n')
    : '- なし';

  const content = `# コーパス健全度レポート ${today}

**総合スコア: ${healthScore}/100**

## クレーム確信度
- 総数: ${Number(cs.total ?? 0)}件（活性+stale）
- 健全(≥0.7): ${Number(cs.healthy ?? 0)}件
- 要注意(<0.3): ${Number(cs.at_risk ?? 0)}件
- Stale済み: ${Number(cs.stale_count ?? 0)}件
- 平均確信度: ${Number(cs.avg_conf ?? 0).toFixed(2)}

## エンティティカバレッジ
- 追跡対象(mention≥3): ${Number(es.total ?? 0)}エンティティ
- クレーム枯渇: ${Number(es.orphaned ?? 0)}エンティティ

## 埋め込みカバレッジ（直近7日）
- 記事数: ${Number(eg.total ?? 0)}件 / 埋め込み未生成: ${Number(eg.missing_embed ?? 0)}件

## 確信度が最も低いエンティティ（要注意）
${staleEntsText}`;

  await db.insert(schema.reports).values({
    type: 'corpus_health',
    content,
    reportDate: today,
  }).onConflictDoNothing();
  console.log(`[Health] スコア ${healthScore}/100 | healthy=${Number(cs.healthy ?? 0)} at_risk=${Number(cs.at_risk ?? 0)}`);
}

async function logPipeline(collected: number, failed: number, durationMs: number) {
  try {
    await db.insert(schema.pipelineLogs).values({
      date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
      collected,
      failed,
      durationMs,
    });
    console.log(`[Log] パイプライン記録: 収集${collected}件, 失敗${failed}件, ${Math.round(durationMs / 1000)}秒`);
  } catch (e: any) {
    console.warn('[Log] ログ記録失敗(非クリティカル):', e.message);
  }
}

// 死亡フィード/APIは停止（404/400/廃止を実測で確認済み）
const DEAD_SOURCE_VALUES = [
  'https://ai.meta.com/blog/feed/',          // 404・代替RSSなし
  'https://www.anthropic.com/rss.xml',       // 404・代替RSSなし
  'https://mistral.ai/news/rss/',            // 404・代替RSSなし
  'https://paperswithcode.com/api/v1/papers/', // APIがHTML返却（廃止）
  'https://www.wired.com/feed/tag/artificial-intelligence/rss', // 400（新URLへ移行）
];

async function ensureSources() {
  const required = [
    { type: 'rss',             value: 'https://techcrunch.com/category/artificial-intelligence/feed/', score: 6 },
    { type: 'hn',              value: 'https://hacker-news.firebaseio.com/v0', score: 5 },
    { type: 'arxiv',           value: 'https://export.arxiv.org/api/query', score: 7 },
    { type: 'github-trending', value: 'https://api.github.com/search/repositories', score: 6 },
    // AI機関公式ブログ（高品質一次情報・Authorityボーナスあり）
    { type: 'rss', value: 'https://huggingface.co/blog/feed.xml',            score: 9 },
    { type: 'rss', value: 'https://deepmind.google/blog/rss.xml',            score: 9 },
    { type: 'rss', value: 'https://openai.com/blog/rss.xml',                 score: 9 },
    { type: 'rss', value: 'https://blogs.microsoft.com/ai/feed/',            score: 8 },
    { type: 'rss', value: 'https://research.google/blog/rss/',               score: 8 },
    // テックメディア（AI特化カテゴリ）
    { type: 'rss', value: 'https://venturebeat.com/category/ai/feed/',       score: 6 },
    { type: 'rss', value: 'https://www.wired.com/feed/tag/ai/latest/rss',    score: 6 }, // 旧URL(404)から移行
    // v4: 無料カバレッジ拡充（検索が唯一拾えていた種類＝日本語/コミュニティ/個人ブログを内製化）
    { type: 'rss', value: 'https://zenn.dev/topics/ai/feed',                 score: 6 }, // Zenn AIトピック
    { type: 'rss', value: 'https://qiita.com/tags/AI/feed.atom',             score: 5 }, // Qiita AIタグ(Atom)
    { type: 'rss', value: 'https://www.reddit.com/r/LocalLLaMA/.rss',        score: 5 }, // Reddit LocalLLaMA(Atom)
    { type: 'rss', value: 'https://lobste.rs/t/ai.rss',                      score: 5 }, // Lobsters AIタグ
    { type: 'rss', value: 'https://simonwillison.net/atom/everything/',      score: 7 }, // Simon Willison(高信号な個人AIブログ)
  ];
  for (const src of required) {
    const existing = await db.select({ id: schema.sources.id, status: schema.sources.status })
      .from(schema.sources)
      .where(eq(schema.sources.value, src.value))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(schema.sources).values({ type: src.type as any, value: src.value, status: 'active', score: src.score });
      console.log(`[Init] ソース追加: ${src.value}`);
    } else if (existing[0].status !== 'active') {
      // 必須フィードがlow-priority等に落ちていたらactiveへ復帰（収集供給源を維持）
      await db.update(schema.sources).set({ status: 'active' }).where(eq(schema.sources.id, existing[0].id));
      console.log(`[Init] ソース復帰(active): ${src.value}`);
    }
  }

  // 死亡フィード/APIを停止（収集失敗ノイズを削減）
  for (const dead of DEAD_SOURCE_VALUES) {
    const r = await db.update(schema.sources)
      .set({ status: 'stopped' })
      .where(and(eq(schema.sources.value, dead), sql`${schema.sources.status} != 'stopped'`));
    if (r.rowsAffected > 0) console.log(`[Init] 死亡ソースを停止: ${dead}`);
  }
}

async function main() {
  const startTime = Date.now();
  _recentTitleCache = null; // キャッシュリセット
  _entityCache = new Map();  // エンティティキャッシュリセット
  const pipelineMode = process.env.PIPELINE_MODE ?? 'full';
  console.log(`=== Daily Pipeline 開始 [mode=${pipelineMode}] ===`, new Date().toISOString());

  try {
    // v3: ベクトル化＋重複排除のみ実行（バックフィル・検証用）
    if (pipelineMode === 'vectors') {
      await runEmbeddings();
      await runStoryGrouping();
      console.log('=== Vectors mode 完了 ===');
      process.exit(0);
    }

    // v3: 知識抽出のみ実行（バックフィル・検証用）。直近14日・最大60件を対象
    if (pipelineMode === 'knowledge') {
      await runKnowledgeExtraction(14, 60);
      console.log('=== Knowledge mode 完了 ===');
      process.exit(0);
    }

    // Batch遡及再抽出（手動・半額）: 改善した抽出ロジックを過去コーパスへ適用
    if (pipelineMode === 'batch_submit') {
      await runBatchSubmit();
      console.log('=== Batch submit mode 完了 ===');
      process.exit(0);
    }
    if (pipelineMode === 'batch_fetch') {
      await runBatchFetch();
      console.log('=== Batch fetch mode 完了 ===');
      process.exit(0);
    }

    // v4: 本文ディープ抽出のみ実行（バックフィル・検証用）
    if (pipelineMode === 'deep') {
      await runDeepExtraction(60);
      console.log('=== Deep extract mode 完了 ===');
      process.exit(0);
    }

    // v4.5: 全記事を非対称(RETRIEVAL_DOCUMENT)で再埋め込み（バックフィル）
    if (pipelineMode === 'reembed') {
      await client.execute(`UPDATE collected_data SET embedding = NULL`);
      await runEmbeddings(2000);
      console.log('=== Reembed mode 完了 ===');
      process.exit(0);
    }

    // v4.5: 本文チャンク埋め込みのみ実行（バックフィル）
    if (pipelineMode === 'chunks') {
      await runChunkEmbeddings(2000);
      console.log('=== Chunks mode 完了 ===');
      process.exit(0);
    }

    // v6: パーソナライズbrief配信のみ（購読者向け・テスト/手動用）
    if (pipelineMode === 'briefs') {
      await sendPersonalizedBriefs();
      console.log('=== Briefs mode 完了 ===');
      process.exit(0);
    }

    // v3.2: 既存データのクリーンアップ（断片関係・無効ベンチ削除＋ベンチ名正規化）
    if (pipelineMode === 'cleanup') {
      await runDataCleanup();
      console.log('=== Cleanup mode 完了 ===');
      process.exit(0);
    }

    // v3.1: 既存リダイレクトURLの一括解決のみ（バックフィル）
    if (pipelineMode === 'fixurls') {
      await fixGroundingUrls();
      console.log('=== FixURL mode 完了 ===');
      process.exit(0);
    }

    // v3.1: 英語タイトル＋クレームの翻訳のみ（バックフィル）。直近分を多めに処理
    if (pipelineMode === 'translate') {
      let total = 0, n = 0;
      do { n = await translateTitles(80); total += n; } while (n >= 60 && total < 400);
      await translateClaims(300);
      console.log(`=== Translate mode 完了（タイトル計${total}件＋クレーム）===`);
      process.exit(0);
    }

    // v3: 自律リサーチのみ実行（検証用）
    if (pipelineMode === 'research') {
      await detectAlerts();
      await generateResearchQuestionsAgent();
      await runNightlyResearch();
      await generateBriefing();
      console.log('=== Research mode 完了 ===');
      process.exit(0);
    }

    await ensureSources();
    // コスト最適化: 収集のみ実行(12:00/18:00)はキーワードGrounding(Google検索)を回さず
    // 無料ソース(RSS/HN/ArXiv/GitHub)の巡回のみ。キーワード検索＋夜間リサーチはフル実行(06:00)で実施。
    // 同一キーワードの日中再検索は新着がほぼ無く重複ばかりで、品質を落とさずGrounding費用を約6割削減できる。
    const keywordRounds = pipelineMode === 'collect' ? 0 : 10;
    const { collected, failed } = await collectData(keywordRounds);

    if (pipelineMode !== 'collect') {
      // v4: 本文ディープ抽出（無料・高重要度記事のrawContentを充填）。非クリティカル
      try {
        await runDeepExtraction();
      } catch (e: any) {
        console.warn('[Pipeline] ディープ抽出失敗(非クリティカル):', e.message);
      }

      // v3: ベクトル化 → 意味的重複排除（失敗しても主処理は継続）
      try {
        await runEmbeddings();
        await runChunkEmbeddings(); // v4.5: パッセージレベル埋め込み
        await runStoryGrouping();
        await translateTitles();
        await translateClaims();
      } catch (e: any) {
        console.warn('[Pipeline] ベクトル/翻訳処理失敗(非クリティカル):', e.message);
      }

      await runKnowledgeExtraction();

      // 確信度スペクトル: 日次decay + stale移行 + カスケード。非クリティカル
      try {
        await runDecayTick();
        await runCorpusHealth();
      } catch (e: any) {
        console.warn('[Pipeline] Decay/Health失敗(非クリティカル):', e.message);
      }

      // v3: 自律リサーチ（アラート検知→問い生成→夜間調査→ブリーフ）。非クリティカル
      let briefingContent: string | null = null;
      try {
        await detectAlerts();
        await generateResearchQuestionsAgent();
        await runNightlyResearch();
        briefingContent = await generateBriefing();
      } catch (e: any) {
        console.warn('[Pipeline] 自律リサーチ失敗(非クリティカル):', e.message);
      }

      const reportContent = await generateReport();
      if (reportContent) {
        // ブリーフィングを朝のメール冒頭に統合
        const emailBody = briefingContent ? `${briefingContent}\n\n---\n\n${reportContent}` : reportContent;
        await sendEmail(emailBody);
      }

      // v6: メール購読ユーザーへパーソナライズbriefを配信（非クリティカル）
      try { await sendPersonalizedBriefs(); } catch (e: any) { console.warn('[Brief] 配信失敗(非クリティカル):', e.message); }

      // JST の曜日・日付を確実に取得（toLocaleStringの文字列分割は環境依存なので使わない）
      const jstDateStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' });
      const jstNow = new Date(jstDateStr);
      const dayOfWeek = jstNow.getDay();   // 0 = Sunday
      const dayOfMonth = jstNow.getDate();

      if (dayOfWeek === 0) {
        const weeklyContent = await generateWeeklyReport();
        if (weeklyContent) await sendEmail(weeklyContent, '週次');
        // 日曜: 学びの振り返り（パーソナルダイジェスト）
        const recap = await generateLearningRecap();
        if (recap) await sendEmail(recap, '学びの振り返り');
        // 日曜: 横断インサイト（アプリ内表示用・メールはしない）
        await generateCrossInsight();
      }

      if (dayOfMonth === 1) {
        const monthlyContent = await generateMonthlyReport();
        if (monthlyContent) await sendEmail(monthlyContent, '月次');
      }

      await evolveSources();
      await monitorFeedHealth();
    }

    const durationMs = Date.now() - startTime;
    await logPipeline(collected, failed, durationMs);
  } catch (e: any) {
    console.error('[Pipeline] 致命的エラー:', e);
    await sendFailureEmail(e);
    process.exit(1);
  }

  console.log('=== Daily Pipeline 完了 ===');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
