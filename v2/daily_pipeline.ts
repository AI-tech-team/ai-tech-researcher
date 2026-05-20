import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { eq, sql, desc, count, and, gte, lt } from 'drizzle-orm';
import { config } from 'dotenv';
import nodemailer from 'nodemailer';
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

// ── RSS収集（TechCrunch AI等）─────────────────────────────────────────
async function collectFromRSS(source: typeof schema.sources.$inferSelect, sevenDaysAgo: string): Promise<number> {
  const res = await fetch(source.value, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  const xml = await res.text();

  const items: Array<{ title: string; link: string; description: string; pubDate: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const chunk = m[1];
    const get = (tag: string) =>
      (chunk.match(new RegExp(`<${tag}[^>]*>(?:<!\[CDATA\[)?([\\s\\S]*?)(?:\]\]>)?<\\/${tag}>`, 'i'))?.[1] ?? '').trim();
    const title = get('title');
    const link = get('link');
    const description = get('description').replace(/<[^>]*>/g, '').slice(0, 500);
    const pubDate = get('pubDate');
    if (title && link) items.push({ title, link, description, pubDate });
  }

  const sevenDaysAgoMs = new Date(sevenDaysAgo).getTime();
  const recent = items.filter(item => {
    if (!item.pubDate) return true;
    const d = new Date(item.pubDate).getTime();
    return isNaN(d) || d >= sevenDaysAgoMs;
  }).slice(0, 10);

  if (recent.length === 0) return 0;

  // バッチ評価（1回のGemini呼び出しで全件スコアリング）
  const batchText = recent.map((item, i) => `[${i}] ${item.title}\n${item.description}`).join('\n\n');
  const { text } = await generateText({
    model: google('gemini-2.5-flash-lite'),
    prompt: `以下の記事をAI技術の観点で評価してください。AI技術と無関係な記事はimportance: 0としてください。

${batchText}

JSON配列で出力（インデックス順を維持）:
[{"importance": 7, "category": "LLM推論|エージェント|ツール/フレームワーク|ハードウェア|ビジネス応用|研究/論文|その他", "summary": "150文字の日本語要約"}, ...]`,
  });

  const evaluations: Array<{ importance: number; category: string; summary: string }> =
    JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());

  let inserted = 0;
  for (let i = 0; i < recent.length; i++) {
    const item = recent[i];
    const ev = evaluations[i];
    if (!ev || ev.importance < 4) continue;
    const pubDate = item.pubDate ? new Date(item.pubDate) : null;
    const r = await db.insert(schema.collectedData).values({
      sourceId: source.id,
      title: item.title,
      url: item.link,
      summary: ev.summary,
      category: ev.category ?? 'その他',
      importanceScore: ev.importance,
      publishedAt: pubDate && !isNaN(pubDate.getTime()) ? pubDate.toISOString() : new Date().toISOString(),
    }).onConflictDoNothing();
    if (r.rowsAffected > 0) inserted++;
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

  // バッチ要約・カテゴリ付与（1回のGemini呼び出し）
  const batchText = candidates.map((item, i) => `[${i}] [HN Score:${item.score}] ${item.title}`).join('\n');
  const { text } = await generateText({
    model: google('gemini-2.5-flash-lite'),
    prompt: `以下のHacker Newsのトップ記事（AI/ML関連）の要約とカテゴリを生成してください。

${batchText}

JSON配列で出力（インデックス順を維持）:
[{"summary": "200文字の専門的な日本語要約", "category": "LLM推論|エージェント|ツール/フレームワーク|ハードウェア|ビジネス応用|研究/論文|その他"}, ...]`,
  });

  const evaluations: Array<{ summary: string; category: string }> =
    JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());

  let inserted = 0;
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const ev = evaluations[i];
    if (!ev) continue;
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
    if (r.rowsAffected > 0) inserted++;
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
  const { text } = await generateText({
    model: google('gemini-2.5-flash-lite'),
    prompt: `以下のArXiv論文（cs.AI/cs.LG/cs.CL）の重要度を評価し、日本語要約を生成してください。

${batchText}

JSON配列で出力（インデックス順を維持）:
[{"importance": 8, "category": "LLM推論|エージェント|ツール/フレームワーク|ハードウェア|ビジネス応用|研究/論文|その他", "summary": "150文字の日本語要約"}, ...]`,
  });

  const evaluations: Array<{ importance: number; category: string; summary: string }> =
    JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());

  let inserted = 0;
  for (let i = 0; i < recent.length; i++) {
    const item = recent[i];
    const ev = evaluations[i];
    if (!ev || ev.importance < 5) continue;
    const r = await db.insert(schema.collectedData).values({
      sourceId: source.id,
      title: item.title,
      url: item.url,
      summary: ev.summary,
      category: ev.category ?? '研究/論文',
      importanceScore: ev.importance,
      tags: JSON.stringify(['arxiv', ev.category ?? '研究/論文']),
      publishedAt: item.published ? new Date(item.published).toISOString() : new Date().toISOString(),
    }).onConflictDoNothing();
    if (r.rowsAffected > 0) inserted++;
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

  const { text } = await generateText({
    model: google('gemini-2.5-flash-lite'),
    prompt: `以下のGitHubトレンドリポジトリ（AI/ML分野）の重要度を評価し、日本語要約を生成してください。

${batchText}

JSON配列で出力（インデックス順を維持）:
[{"importance": 7, "category": "LLM推論|エージェント|ツール/フレームワーク|ハードウェア|ビジネス応用|研究/論文|その他", "summary": "150文字の日本語要約"}, ...]`,
  });

  const evaluations: Array<{ importance: number; category: string; summary: string }> =
    JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());

  let inserted = 0;
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const ev = evaluations[i];
    if (!ev || ev.importance < 5) continue;
    const r = await db.insert(schema.collectedData).values({
      sourceId: source.id,
      title: `[GitHub] ${item.full_name}`,
      url: item.html_url,
      summary: ev.summary,
      category: ev.category ?? 'ツール/フレームワーク',
      importanceScore: ev.importance,
      tags: JSON.stringify(['github-trending', `⭐${item.stargazers_count}`]),
      publishedAt: item.created_at ?? new Date().toISOString(),
    }).onConflictDoNothing();
    if (r.rowsAffected > 0) inserted++;
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
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIResearcher/1.0)' },
            signal: AbortSignal.timeout(10000),
          });
          const html = await res.text();
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

  // キーワード型ソース（同一ソースを重複選択しない）
  const processedSourceIds = new Set<number>();
  for (let i = 0; i < rounds; i++) {
    const sourceList = await db.select().from(schema.sources)
      .where(and(
        eq(schema.sources.status, 'active'),
        sql`${schema.sources.type} IN ('url', 'keyword')`,
        processedSourceIds.size > 0
          ? sql`${schema.sources.id} NOT IN (${sql.join([...processedSourceIds].map(id => sql`${id}`), sql`, `)})`
          : undefined,
      ))
      .orderBy(sql`RANDOM() * (1 + COALESCE(${schema.sources.score}, 0)) DESC`)
      .limit(1);

    if (sourceList.length === 0) break;
    const target = sourceList[0];
    processedSourceIds.add(target.id);
    if (target.type === 'url') continue; // 既に処理済み

    try {
      const result = await generateText({
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
      });

      const jsonStr = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(jsonStr);

      const googleMeta = (result.providerMetadata?.google ?? (result as any).experimental_providerMetadata?.google) as any;
      const groundingChunks: any[] = googleMeta?.groundingMetadata?.groundingChunks ?? [];
      const groundingUrl = groundingChunks
        .map((c: any) => c.web?.uri as string | undefined)
        .filter((uri): uri is string => !!uri)
        .find(uri => !GROUNDING_SKIP_DOMAINS.some(d => uri.includes(d)));
      if (groundingUrl) parsedData.url = groundingUrl;

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
        summary: parsedData.summary, category: parsedData.category ?? null,
        importanceScore: parsedData.importance ?? 5, tags: tagsJson,
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

  const { text } = await generateText({
    model: google('gemini-2.5-flash-lite'),
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
  });

  const [insertedReport] = await db.insert(schema.reports).values({
    type: 'daily',
    content: text,
    reportDate: reportDateJST,
  }).returning({ id: schema.reports.id });

  const adoptedSourceIds = [...new Set(
    recentData.map(d => d.sourceId).filter((id): id is number => id !== null)
  )];
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

  const { text } = await generateText({
    model: google('gemini-2.5-flash-lite'),
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
  });

  const reportDateJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  await db.insert(schema.reports).values({ type: 'weekly', content: text, reportDate: reportDateJST });

  console.log('[WeeklyReport] 週次レポート生成完了');
  return text;
}

async function sendEmail(reportContent: string, type: 'デイリー' | '週次' = 'デイリー') {
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
    // RSS/HN/ArXiv/GitHubTrending型は常にactiveを維持（自動停止しない）
    if (source.type === 'rss' || source.type === 'hn' || source.type === 'arxiv' || source.type === 'github-trending') continue;

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

  for (const u of updates) {
    await db.update(schema.sources)
      .set({ status: u.status, score: u.score })
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

  const { text } = await generateText({
    model: google('gemini-2.5-flash-lite'),
    prompt: `以下の高品質AI記事（重要度7以上）から、追跡すべき具体的なAI技術キーワードを最大5つ抽出してください。

【抽出条件】
- 特定のモデル名・アーキテクチャ名・手法名・ツール名・フレームワーク名のみ
- 「AI」「LLM」「機械学習」「モデル」「研究」「技術」などの汎用語は含めない
- 固有名詞・略語・製品名を優先（例: Mamba, FlashAttention, LoRA, Phi-4, GRPO）
- 正式名称・最も一般的な表記で統一する

JSON配列のみで出力: ["keyword1", "keyword2", ...]

【記事】
${contextText}`,
  });

  try {
    const rawKws: string[] = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
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

      const res = await db.insert(schema.sources)
        .values({ type: 'keyword', value: trimmed, status: 'candidate', score: initialScore })
        .onConflictDoNothing();
      if (res.rowsAffected > 0) {
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
}

async function logPipeline(collected: number, failed: number, durationMs: number) {
  try {
    await db.insert(schema.pipelineLogs).values({
      date: new Date().toISOString().split('T')[0],
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
    { type: 'rss',             value: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
    { type: 'hn',              value: 'https://hacker-news.firebaseio.com/v0' },
    { type: 'arxiv',           value: 'https://export.arxiv.org/api/query' },
    { type: 'github-trending', value: 'https://api.github.com/search/repositories' },
  ];
  for (const src of required) {
    const existing = await db.select({ id: schema.sources.id })
      .from(schema.sources)
      .where(eq(schema.sources.value, src.value))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(schema.sources).values({ type: src.type as any, value: src.value, status: 'active', score: 5 });
      console.log(`[Init] ソース追加: ${src.value}`);
    }
  }
}

async function main() {
  const startTime = Date.now();
  console.log('=== Daily Pipeline 開始 ===', new Date().toISOString());

  try {
    await ensureSources();
    const { collected, failed } = await collectData(10);
    const reportContent = await generateReport();
    if (reportContent) await sendEmail(reportContent);

    // 日曜日は週次レポートも生成してメール送信
    const dayOfWeek = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'Asia/Tokyo' });
    if (dayOfWeek === 'Sun') {
      const weeklyContent = await generateWeeklyReport();
      if (weeklyContent) await sendEmail(weeklyContent, '週次');
    }

    await evolveSources();
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
