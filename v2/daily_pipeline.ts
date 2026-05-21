import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { google } from '@ai-sdk/google';
import { generateText, generateObject, embedMany } from 'ai';
import { z } from 'zod';
import { eq, sql, desc, count, and, gte, lt } from 'drizzle-orm';
import { config } from 'dotenv';
import * as nodemailer from 'nodemailer';
import * as schema from './src/db/schema';

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

const ArticleEvalSchema = z.object({
  items: z.array(z.object({
    importance: z.number().int().min(0).max(10),
    category: z.enum(CATS),
    summary: z.string().max(300),
  })),
});

const HnEvalSchema = z.object({
  items: z.array(z.object({
    summary: z.string().max(300),
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
      (chunk.match(new RegExp(`<${tag}[^>]*>(?:<!\[CDATA\[)?([\\s\\S]*?)(?:\]\]>)?<\\/${tag}>`, 'i'))?.[1] ?? '').trim();
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

  const batchText = recent.map((item, i) => `[${i}] ${item.title}\n${item.description}`).join('\n\n');
  const { object } = await withRetry(() => generateObject({
    model: google('gemini-2.5-flash-lite'),
    schema: ArticleEvalSchema,
    prompt: `以下の記事をAI技術の観点で評価してください。AI技術と無関係な記事はimportance: 0にしてください。各記事のimportance(0-10)、category、日本語summary(150文字)を生成してください。必ず${recent.length}件分のitemsを返してください。\n\n${batchText}`,
  }));
  const evaluations = object.items;
  if (evaluations.length !== recent.length) {
    console.warn(`  [RSS] 評価数不一致: LLM=${evaluations.length}件 / 取得=${recent.length}件`);
  }
  const authorityBonus = getAuthorityBonus(source);

  const titleCache = await getRecentTitleCache();
  let inserted = 0;
  for (let i = 0; i < recent.length; i++) {
    const item = recent[i];
    const ev = evaluations[i];
    if (!ev || ev.importance < 4) continue;
    if (isNearDuplicate(item.title, titleCache)) continue;
    const pubDate = item.pubDate ? new Date(item.pubDate) : null;
    const r = await db.insert(schema.collectedData).values({
      sourceId: source.id,
      title: item.title,
      url: item.link,
      summary: ev.summary,
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

  const batchText = candidates.map((item, i) => `[${i}] [HN Score:${item.score}] ${item.title}`).join('\n');
  const { object: hnObject } = await withRetry(() => generateObject({
    model: google('gemini-2.5-flash-lite'),
    schema: HnEvalSchema,
    prompt: `以下のHacker NewsのAI/ML関連記事の専門的な日本語summary（200文字）とcategoryを生成してください。\n\n${batchText}`,
  }));
  const evaluations = hnObject.items;

  const titleCache = await getRecentTitleCache();
  let inserted = 0;
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
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
      (chunk.match(new RegExp(`<${tag}[^>]*>(?:<!\[CDATA\[)?([\\s\\S]*?)(?:\]\]>)?<\\/${tag}>`, 'i'))?.[1] ?? '').trim();
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

  const batchText = recent.map((e, i) => `[${i}] ${e.title}\n${e.summary}`).join('\n\n');
  const { object: arxivObject } = await withRetry(() => generateObject({
    model: google('gemini-2.5-flash-lite'),
    schema: ArticleEvalSchema,
    prompt: `以下のArXiv論文（cs.AI/cs.LG/cs.CL）の技術的重要度(0-10)、category、日本語summary(150文字)を評価してください。必ず${recent.length}件分のitemsを返してください。\n\n${batchText}`,
  }));
  const evaluations = arxivObject.items;
  if (evaluations.length !== recent.length) {
    console.warn(`  [ArXiv] 評価数不一致: LLM=${evaluations.length}件 / 取得=${recent.length}件`);
  }
  const authorityBonus = getAuthorityBonus(source);

  const titleCache = await getRecentTitleCache();
  let inserted = 0;
  for (let i = 0; i < recent.length; i++) {
    const item = recent[i];
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
  const url = `https://api.github.com/search/repositories?q=topic:llm+OR+topic:ai-agent+OR+topic:machine-learning+stars:>200+created:>${sevenDaysAgo}&sort=stars&order=desc&per_page=15`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'AIResearcher/1.0', 'Accept': 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const json = await res.json();
  const items: any[] = json.items ?? [];
  if (items.length === 0) return 0;

  const candidates = items.slice(0, 10);
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

  const recent = results.filter(p => p.published && p.published >= sevenDaysAgo).slice(0, 10);
  if (recent.length === 0) return 0;

  const batchText = recent.map((p, i) =>
    `[${i}] ${p.title}\n${p.abstract?.slice(0, 400) ?? ''}\nTasks: ${(p.tasks ?? []).slice(0, 3).map((t: any) => t.name).join(', ')}`
  ).join('\n\n');

  const { object: pwcObject } = await withRetry(() => generateObject({
    model: google('gemini-2.5-flash-lite'),
    schema: ArticleEvalSchema,
    prompt: `以下のPapers with Codeの論文（コード実装あり）の技術的重要度(0-10)、category、日本語summary(150文字)を評価してください。必ず${recent.length}件分のitemsを返してください。\n\n${batchText}`,
  }));
  const evaluations = pwcObject.items;
  if (evaluations.length !== recent.length) {
    console.warn(`  [PwC] 評価数不一致: LLM=${evaluations.length}件 / 取得=${recent.length}件`);
  }
  const authorityBonus = getAuthorityBonus(source);

  const titleCache = await getRecentTitleCache();
  let inserted = 0;
  for (let i = 0; i < recent.length; i++) {
    const item = recent[i];
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
        try {
          const deepFetchRes = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
            signal: AbortSignal.timeout(10000),
          });
          const html = await deepFetchRes.text();
          const fullText = html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 5000);
          await db.update(schema.collectedData)
            .set({ rawContent: fullText })
            .where(eq(schema.collectedData.url, url));
          console.log(`    [深掘り] ${url.slice(0, 60)}`);
        } catch { /* ignore */ }
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

      const jsonStr = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(jsonStr);

      const googleMeta = (result.providerMetadata?.google ?? (result as any).experimental_providerMetadata?.google) as any;
      const groundingChunks: any[] = googleMeta?.groundingMetadata?.groundingChunks ?? [];
      const groundingUrl = groundingChunks
        .map((c: any) => c.web?.uri as string | undefined)
        .filter((uri): uri is string => !!uri)
        .find(uri => !GROUNDING_SKIP_DOMAINS.some(d => uri.includes(d)));
      if (groundingUrl) parsedData.url = groundingUrl;

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

  const sevenDaysAgoISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgoISO = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [recentData, thisWeekCounts, lastWeekCounts] = await Promise.all([
    db.select().from(schema.collectedData)
      .where(gte(schema.collectedData.createdAt, sevenDaysAgoISO))
      .orderBy(desc(schema.collectedData.importanceScore), desc(schema.collectedData.createdAt))
      .limit(15),
    db.select({ category: schema.collectedData.category, cnt: count() })
      .from(schema.collectedData)
      .where(gte(schema.collectedData.createdAt, sevenDaysAgoISO))
      .groupBy(schema.collectedData.category),
    db.select({ category: schema.collectedData.category, cnt: count() })
      .from(schema.collectedData)
      .where(and(
        gte(schema.collectedData.createdAt, fourteenDaysAgoISO),
        lt(schema.collectedData.createdAt, sevenDaysAgoISO),
      ))
      .groupBy(schema.collectedData.category),
  ]);

  if (recentData.length === 0) { console.log('[Report] データなし、スキップ'); return null; }

  const contextStr = recentData
    .map(d => `[重要度:${d.importanceScore ?? 5}/10][${d.category ?? '未分類'}] ${d.title}\n${d.summary}\nURL: ${d.url}\n公開日: ${d.publishedAt?.split('T')[0] ?? '不明'}`)
    .join('\n\n---\n\n');

  const lastWeekMap = new Map(lastWeekCounts.map(r => [r.category, Number(r.cnt)]));
  const trendLines = thisWeekCounts
    .map(r => ({
      cat: r.category ?? 'その他',
      now: Number(r.cnt),
      prev: lastWeekMap.get(r.category ?? '') ?? 0,
    }))
    .filter(r => r.now >= 2)
    .map(r => ({ ...r, ratio: r.prev === 0 ? r.now * 2 : r.now / r.prev }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5)
    .map(r => `${r.cat}: 今週${r.now}件/先週${r.prev}件${r.ratio >= 2 ? ' 🚀急上昇' : r.ratio >= 1.3 ? ' ↑上昇' : r.ratio <= 0.7 ? ' ↓減少' : ''}`);

  const trendText = trendLines.length > 0
    ? '\n\n【カテゴリ別週次トレンド（参考データ）】\n' + trendLines.join('\n')
    : '';

  // 前日レポートのキーテーマを引き継ぎ（レポートの記憶）
  const prevDaily = await db.select({ content: schema.reports.content })
    .from(schema.reports)
    .where(eq(schema.reports.type, 'daily'))
    .orderBy(desc(schema.reports.createdAt))
    .limit(1);
  const prevContext = prevDaily[0]?.content
    ? '\n\n【昨日のキートピック（続報があれば優先して報告）】\n' + prevDaily[0].content.substring(0, 500)
    : '';

  const todayJST = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });
  const reportDateJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const { text } = await withRetry(() => generateText({
    model: google('gemini-2.5-flash'),
    system: `あなたはAI技術動向の専門アナリストです。収集データを元に、AIエンジニア・研究者向けのデイリーレポートをMarkdown形式で作成してください。

【必須構成】
## 🔥 今日のハイライト
重要度8以上の記事を中心に3〜5点。各項目は「何が起きたか」「なぜ重要か」「実務への影響」を2〜3行で。

## 🚀 急上昇トレンド
トレンドデータを参考に、今週急増しているカテゴリ・トピックを1段落で解説。増加の技術的背景と今後の展望を含めること。データがない場合は今週特に目立つテーマを記述。

## 📊 カテゴリ別トピック
カテゴリ（LLM推論/エージェント/ツール/フレームワーク/ハードウェア/ビジネス応用/研究・論文）ごとに整理。

## 💡 エンジニアへの実践的インサイト
今日のデータから導き出せる実装・採用・評価のポイントを箇条書きで。

【ルール】
- 全体1500〜2000文字
- 具体的な数値・ベンチマーク・実装詳細を含める
- 主観的な「すごい」ではなく客観的な事実ベースで記述
- 重要度が高い記事ほど詳しく解説する
- 絵文字・箇条書きを活用して読みやすく`,
    prompt: `今日の日付: ${todayJST}${trendText}${prevContext}\n\n【収集データ（重要度順・${recentData.length}件）】\n${contextStr}`,
  }));

  const [insertedReport] = await db.insert(schema.reports).values({
    type: 'daily',
    content: text,
    reportDate: reportDateJST,
  }).returning({ id: schema.reports.id });

  const adoptedSourceIds = Array.from(new Set(
    recentData.map(d => d.sourceId).filter((id): id is number => id !== null)
  ));
  if (insertedReport?.id && adoptedSourceIds.length > 0) {
    await db.insert(schema.adoptionLogs).values(
      adoptedSourceIds.map(sourceId => ({
        reportId: insertedReport.id,
        sourceId,
        isAdopted: 1 as const,
      }))
    );
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

async function sendEmail(reportContent: string, type: 'デイリー' | '週次' | '月次' = 'デイリー') {
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

// ── v3: エンティティ正規化（GPT-4o / GPT4o / gpt-4 omni → 同一ノード）─────
let _entityCache: Map<string, { id: number; canonicalName: string }> = new Map();

function normalizeEntityKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
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

// ── v3: 知識抽出（claims + benchmarks + relations を1回の呼び出しで）──────
async function runKnowledgeExtraction(sinceDays = 1, limit = 10) {
  console.log('[Knowledge] 知識抽出開始');
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  const targets = await db.select({
    id: schema.collectedData.id,
    title: schema.collectedData.title,
    summary: schema.collectedData.summary,
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
        prompt: `以下の記事から構造化された知識を抽出してください。該当がなければ空配列。

【claims】検証可能な具体的主張を最大3つ。subject(主語:モデル/企業名)+predicate(述語:指標)+value(具体値)。「AIが進化」等の汎用主張は除外。
【benchmarks】AIモデル/システムの「評価ベンチマークスコア」のみ最大5つ。entity(モデル名)+benchmark(ベンチ名)+score(比較可能な数値)+unit(%/points/Elo等、不明はnull)。
  対象例: MMLU, GSM8K, SWE-bench, HumanEval, MMMU, GPQA, AIME, MATH, Chatbot Arena Elo, ARC-AGI 等。
  除外: CPUコア数・RAM/メモリ容量・TOPS・クロック等のハードウェアスペック、価格、トークン数、'1'のような順位/件数、ベンチ名が曖昧なもの。
【relations】エンティティ間の明確な関係を最大5つ。subject+relation(${RELATION_TYPES.join('/')})+object。具体的な固有名詞同士のみ（一般名詞・文の断片は除外）。例: "Claude 4" outperforms "GPT-4"。

記事: ${article.title ?? ''}\n${article.summary ?? ''}`,
      }));

      // ── claims（stale移行つき）──
      for (const claim of object.claims) {
        const entity = await resolveEntity(claim.subject);
        // 同一subject+predicateで異なるvalueの既存activeクレームをstaleに
        if (claim.confidence === 'high') {
          const res = await db.update(schema.claims)
            .set({ status: 'stale' })
            .where(and(
              eq(schema.claims.subject, claim.subject),
              eq(schema.claims.predicate, claim.predicate),
              sql`LOWER(${schema.claims.value}) != ${claim.value.toLowerCase()}`,
              eq(schema.claims.status, 'active'),
            ));
          staleCount += res.rowsAffected;
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
        claimCount++;
      }

      // ── benchmarks（時系列なので全件保存）──
      for (const b of object.benchmarks) {
        if (!Number.isFinite(b.score)) continue;
        const entity = await resolveEntity(b.entity);
        await db.insert(schema.benchmarks).values({
          entityId: entity?.id ?? null,
          entityName: entity?.canonicalName ?? b.entity.trim(),
          benchmarkName: b.benchmark.trim(),
          score: b.score,
          unit: b.unit ?? null,
          articleId: article.id,
          sourceUrl: article.url,
          recordedDate: validFrom,
          confidence: b.confidence,
        });
        benchCount++;
      }

      // ── relations（エッジ重複排除・矛盾stale）──
      for (const r of object.relations) {
        const subj = await resolveEntity(r.subject);
        const obj = await resolveEntity(r.object);
        const subjName = subj?.canonicalName ?? r.subject.trim();
        const objName = obj?.canonicalName ?? r.object.trim();
        if (!subjName || !objName || subjName === objName) continue;

        // outperforms の逆向きactiveエッジをstaleに（A>B が来たら B>A を陳腐化）
        if (r.relation === 'outperforms') {
          const res = await db.update(schema.relations)
            .set({ status: 'stale' })
            .where(and(
              eq(schema.relations.relationType, 'outperforms'),
              eq(schema.relations.subjectName, objName),
              eq(schema.relations.objectName, subjName),
              eq(schema.relations.status, 'active'),
            ));
          staleCount += res.rowsAffected;
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
        relCount++;
      }
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

    if (source.status === 'candidate') {
      if (hitCount14d >= 3 && lastAdoptedAt) {
        newStatus = 'active'; promoted++;
      } else if (daysSinceCreated >= 14) {
        newStatus = 'stopped'; stoppedCount++;
      }
    } else if (source.status === 'active') {
      if (daysSinceAdopted >= 14) { newStatus = 'low-priority'; demoted++; }
    } else if (source.status === 'low-priority') {
      if (daysSinceAdopted < 14) { newStatus = 'active'; reactivated++;
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

  try {
    const highQualityUrls = await db.select({ url: schema.collectedData.url })
      .from(schema.collectedData)
      .where(and(
        gte(schema.collectedData.createdAt, fourteenDaysAgo),
        gte(schema.collectedData.importanceScore, 9),
      ))
      .limit(30);

    let newDomainsCount = 0;
    for (const { url } of highQualityUrls) {
      if (!url) continue;
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        if (DOMAIN_SKIP.has(hostname)) continue;
        if (existingLower.has(hostname)) continue;
        const r = await db.insert(schema.sources)
          .values({ type: 'keyword', value: hostname, status: 'candidate', score: 2 })
          .onConflictDoNothing();
        if (r.rowsAffected > 0) {
          newDomainsCount++;
          existingLower.add(hostname);
        }
      } catch { }
    }
    if (newDomainsCount > 0) console.log(`[Evolve] 新規ドメイン候補${newDomainsCount}件追加`);
  } catch (e: any) {
    console.warn('[Evolve] ドメイン発見失敗(非クリティカル):', e.message);
  }

  // ── 改善2: 重要度スコアの相対化（30日分のパーセンタイル正規化）────────
  try {
    const thirtyDaysAgoISO = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const allScores = await db.select({
      id: schema.collectedData.id,
      score: schema.collectedData.importanceScore,
    })
      .from(schema.collectedData)
      .where(gte(schema.collectedData.createdAt, thirtyDaysAgoISO));

    if (allScores.length >= 10) {
      const sorted = allScores.map(r => r.score ?? 5).sort((a, b) => a - b);
      const n = sorted.length;
      // 各スコア値（0-10）に対応する正規化スコアをマップ
      const scoreToNorm = new Map<number, number>();
      for (let s = 0; s <= 10; s++) {
        const rank = sorted.filter(x => x <= s).length;
        scoreToNorm.set(s, Math.max(1, Math.min(10, Math.round((rank / n) * 9) + 1)));
      }
      // スコア値ごとに一括UPDATE
      for (const [raw, norm] of scoreToNorm) {
        if (raw === norm) continue; // 変化なしはスキップ
        await db.update(schema.collectedData)
          .set({ normalizedImportanceScore: norm })
          .where(and(
            eq(schema.collectedData.importanceScore, raw),
            gte(schema.collectedData.createdAt, thirtyDaysAgoISO),
          ));
      }
      console.log(`[Evolve] スコア正規化: ${n}件処理`);
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
        providerOptions: { google: { outputDimensionality: EMBED_DIM, taskType: 'SEMANTIC_SIMILARITY' } },
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

async function ensureSources() {
  const required = [
    { type: 'rss',             value: 'https://techcrunch.com/category/artificial-intelligence/feed/', score: 6 },
    { type: 'hn',              value: 'https://hacker-news.firebaseio.com/v0', score: 5 },
    { type: 'arxiv',           value: 'https://export.arxiv.org/api/query', score: 7 },
    { type: 'github-trending', value: 'https://api.github.com/search/repositories', score: 6 },
    { type: 'pwc',             value: 'https://paperswithcode.com/api/v1/papers/', score: 8 },
    // AI機関公式ブログ（高品質一次情報・Authorityボーナスあり）
    { type: 'rss', value: 'https://huggingface.co/blog/feed.xml',            score: 9 },
    { type: 'rss', value: 'https://deepmind.google/blog/rss.xml',            score: 9 },
    { type: 'rss', value: 'https://openai.com/blog/rss.xml',                 score: 9 },
    { type: 'rss', value: 'https://ai.meta.com/blog/feed/',                  score: 8 },
    { type: 'rss', value: 'https://www.anthropic.com/rss.xml',               score: 9 },
    { type: 'rss', value: 'https://blogs.microsoft.com/ai/feed/',            score: 8 },
    { type: 'rss', value: 'https://research.google/blog/rss/',               score: 8 },
    { type: 'rss', value: 'https://mistral.ai/news/rss/',                    score: 8 },
    // テックメディア（AI特化カテゴリ）
    { type: 'rss', value: 'https://venturebeat.com/category/ai/feed/',       score: 6 },
    { type: 'rss', value: 'https://www.wired.com/feed/tag/artificial-intelligence/rss', score: 6 },
  ];
  for (const src of required) {
    const existing = await db.select({ id: schema.sources.id })
      .from(schema.sources)
      .where(eq(schema.sources.value, src.value))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(schema.sources).values({ type: src.type as any, value: src.value, status: 'active', score: src.score });
      console.log(`[Init] ソース追加: ${src.value}`);
    }
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

    await ensureSources();
    const { collected, failed } = await collectData(10);

    if (pipelineMode !== 'collect') {
      // v3: ベクトル化 → 意味的重複排除（失敗しても主処理は継続）
      try {
        await runEmbeddings();
        await runStoryGrouping();
      } catch (e: any) {
        console.warn('[Pipeline] ベクトル処理失敗(非クリティカル):', e.message);
      }

      await runKnowledgeExtraction();

      const reportContent = await generateReport();
      if (reportContent) await sendEmail(reportContent);

      // JST の曜日・日付を確実に取得（toLocaleStringの文字列分割は環境依存なので使わない）
      const jstDateStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' });
      const jstNow = new Date(jstDateStr);
      const dayOfWeek = jstNow.getDay();   // 0 = Sunday
      const dayOfMonth = jstNow.getDate();

      if (dayOfWeek === 0) {
        const weeklyContent = await generateWeeklyReport();
        if (weeklyContent) await sendEmail(weeklyContent, '週次');
      }

      if (dayOfMonth === 1) {
        const monthlyContent = await generateMonthlyReport();
        if (monthlyContent) await sendEmail(monthlyContent, '月次');
      }

      await evolveSources();
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
