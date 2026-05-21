'use server';

import { db } from '@/db';
import { sources, collectedData, reports, adoptionLogs, pipelineLogs, claims, userTopicWeights } from '@/db/schema';
import { desc, eq, count, gte, lte, sql, like, or, isNotNull, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import type { CollectedItem, PipelineLog, TrendingKeyword, Claim, ConflictingClaim, UserTopicWeight } from '@/types';

// ─── 共通クエリヘルパー ───────────────────────────────────────────

function parseCollectedRows(rows: any[]): CollectedItem[] {
  return rows.map(row => ({
    ...row,
    tags: row.tags
      ? (() => { try { return JSON.parse(row.tags); } catch { return null; } })()
      : null,
  }));
}

const COLLECTED_SELECT = {
  id: collectedData.id,
  title: collectedData.title,
  url: collectedData.url,
  summary: collectedData.summary,
  category: collectedData.category,
  isFavorited: collectedData.isFavorited,
  isReadLater: collectedData.isReadLater,
  isRead: collectedData.isRead,
  importanceScore: collectedData.importanceScore,
  normalizedImportanceScore: collectedData.normalizedImportanceScore,
  tags: collectedData.tags,
  publishedAt: collectedData.publishedAt,
  createdAt: collectedData.createdAt,
  sourceValue: sources.value,
  sourceType: sources.type,
  storyId: collectedData.storyId,
  storyCount: collectedData.storyCount,
};

// タイトルとカテゴリから固有技術キーワードを抽出（トピック重み更新用）
function extractKeywords(title: string | null, category: string | null): string[] {
  const kws: string[] = [];
  if (category) kws.push(category);
  // 英語の固有名詞・技術用語（先頭大文字 or 全大文字、3文字以上）
  const terms = (title ?? '').match(/[A-Z][a-zA-Z0-9-]{2,}|[A-Z]{3,}/g) ?? [];
  return [...new Set([...kws, ...terms.slice(0, 4)])];
}

// ─── データ取得 ───────────────────────────────────────────────────

export async function getReportsData() {
  try {
    return await db.select().from(reports).orderBy(desc(reports.createdAt));
  } catch (error) {
    console.error("Failed to fetch reports:", error);
    return [];
  }
}

export async function getSourcesData() {
  try {
    return await db.select().from(sources).orderBy(desc(sources.score));
  } catch (error) {
    console.error("Failed to fetch sources:", error);
    return [];
  }
}

export async function getCollectedDataList(): Promise<CollectedItem[]> {
  try {
    const rows = await db.select(COLLECTED_SELECT)
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .orderBy(desc(collectedData.createdAt))
      .limit(100);
    return parseCollectedRows(rows);
  } catch (error) {
    console.error("Failed to fetch collected data:", error);
    return [];
  }
}

export async function getActivityData() {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const rows = await db.select({
      date: sql<string>`strftime('%Y-%m-%d', ${collectedData.createdAt})`.as('date'),
      cnt: count(),
    })
      .from(collectedData)
      .where(gte(collectedData.createdAt, sevenDaysAgo.toISOString()))
      .groupBy(sql`strftime('%Y-%m-%d', ${collectedData.createdAt})`);

    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const result: { name: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const found = rows.find(r => r.date === dateStr);
      result.push({ name: dayNames[d.getDay()], count: found ? Number(found.cnt) : 0 });
    }
    return result;
  } catch (error) {
    console.error("Failed to fetch activity data:", error);
    return [];
  }
}

export async function getSourcePerformance() {
  try {
    return await db.select({
      id: sources.id,
      value: sources.value,
      type: sources.type,
      status: sources.status,
      score: sources.score,
      lastHitAt: sources.lastHitAt,
      collectedCount: sql<number>`COUNT(${collectedData.id})`.as('collected_count'),
    })
      .from(sources)
      .leftJoin(collectedData, eq(collectedData.sourceId, sources.id))
      .where(sql`${sources.status} != 'stopped'`)
      .groupBy(sources.id)
      .orderBy(sql`COUNT(${collectedData.id}) DESC`)
      .limit(50);
  } catch (error) {
    console.error("Failed to fetch source performance:", error);
    return [];
  }
}

export async function getSourceROI() {
  try {
    const rows = await db.select({
      id: sources.id,
      value: sources.value,
      type: sources.type,
      status: sources.status,
      score: sources.score,
      lastHitAt: sources.lastHitAt,
      collectedCount: sql<number>`COUNT(${collectedData.id})`.as('collected_count'),
      avgImportance: sql<number>`COALESCE(AVG(${collectedData.importanceScore}), 5)`.as('avg_importance'),
    })
      .from(sources)
      .leftJoin(collectedData, eq(collectedData.sourceId, sources.id))
      .where(sql`${sources.status} != 'stopped'`)
      .groupBy(sources.id)
      .orderBy(sql`COUNT(${collectedData.id}) * COALESCE(AVG(${collectedData.importanceScore}), 5) DESC`)
      .limit(50);

    return rows.map(r => ({
      ...r,
      roi: Number(r.collectedCount) * Number(r.avgImportance),
    }));
  } catch (error) {
    console.error("Failed to fetch source ROI:", error);
    return [];
  }
}

export async function getCategoryTrendData() {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const rows = await db.select({
      date: sql<string>`strftime('%Y-%m-%d', ${collectedData.createdAt})`,
      category: collectedData.category,
      cnt: count(),
    })
      .from(collectedData)
      .where(gte(collectedData.createdAt, sevenDaysAgo.toISOString()))
      .groupBy(sql`strftime('%Y-%m-%d', ${collectedData.createdAt})`, collectedData.category);

    const CATS = ['LLM推論', 'エージェント', 'ツール/フレームワーク', 'ハードウェア', 'ビジネス応用', '研究/論文', 'その他'];
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

    const result: any[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const entry: any = { name: `${d.getMonth() + 1}/${d.getDate()}(${dayNames[d.getDay()]})` };
      for (const cat of CATS) {
        const found = rows.find(r => r.date === dateStr && r.category === cat);
        entry[cat] = found ? Number(found.cnt) : 0;
      }
      result.push(entry);
    }
    return result;
  } catch (error) {
    console.error("Failed to fetch category trend:", error);
    return [];
  }
}

export async function getModelMentionData() {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const rows = await db.select({ summary: collectedData.summary, title: collectedData.title })
      .from(collectedData)
      .where(gte(collectedData.createdAt, thirtyDaysAgo.toISOString()));

    const fullText = rows.map(r => `${r.title ?? ''} ${r.summary ?? ''}`).join(' ');

    const models = [
      { name: 'GPT-5', pattern: /gpt-?5/gi },
      { name: 'GPT-4', pattern: /gpt-?4/gi },
      { name: 'Claude', pattern: /claude/gi },
      { name: 'Gemini', pattern: /gemini/gi },
      { name: 'Llama', pattern: /llama/gi },
      { name: 'Mistral', pattern: /mistral/gi },
      { name: 'Grok', pattern: /grok/gi },
      { name: 'Qwen', pattern: /qwen/gi },
      { name: 'DeepSeek', pattern: /deepseek/gi },
    ];

    return models
      .map(m => ({ model: m.name, count: (fullText.match(m.pattern) ?? []).length }))
      .filter(m => m.count > 0)
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    console.error("Failed to fetch model mentions:", error);
    return [];
  }
}

export async function getTrendingKeywords(): Promise<TrendingKeyword[]> {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [thisWeekRows, lastWeekRows] = await Promise.all([
      db.select({
        sourceId: collectedData.sourceId,
        cnt: count(),
      })
        .from(collectedData)
        .where(gte(collectedData.createdAt, sevenDaysAgo))
        .groupBy(collectedData.sourceId),
      db.select({
        sourceId: collectedData.sourceId,
        cnt: count(),
      })
        .from(collectedData)
        .where(and(
          gte(collectedData.createdAt, fourteenDaysAgo),
          lte(collectedData.createdAt, sevenDaysAgo),
        ))
        .groupBy(collectedData.sourceId),
    ]);

    const sourceIds = [...new Set([
      ...thisWeekRows.map(r => r.sourceId),
      ...lastWeekRows.map(r => r.sourceId),
    ])].filter(Boolean) as number[];

    if (sourceIds.length === 0) return [];

    const srcRows = await db.select({ id: sources.id, value: sources.value })
      .from(sources)
      .where(sql`${sources.id} IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)})`);

    const srcMap = new Map(srcRows.map(s => [s.id, s.value]));

    const thisWeekMap = new Map(thisWeekRows.map(r => [r.sourceId, Number(r.cnt)]));
    const lastWeekMap = new Map(lastWeekRows.map(r => [r.sourceId, Number(r.cnt)]));

    const result: TrendingKeyword[] = [];
    for (const id of sourceIds) {
      const keyword = srcMap.get(id);
      if (!keyword) continue;
      const thisWeek = thisWeekMap.get(id) ?? 0;
      const lastWeek = lastWeekMap.get(id) ?? 0;
      const delta = thisWeek - lastWeek;
      if (thisWeek > 0) {
        result.push({ keyword, thisWeek, lastWeek, delta });
      }
    }

    return result
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 5);
  } catch (error) {
    console.error("Failed to fetch trending keywords:", error);
    return [];
  }
}

export async function getPipelineLogs(): Promise<PipelineLog[]> {
  try {
    const rows = await db.select().from(pipelineLogs)
      .orderBy(desc(pipelineLogs.date))
      .limit(30);
    return rows.map(r => ({
      id: r.id,
      date: r.date,
      collected: r.collected ?? 0,
      failed: r.failed ?? 0,
      durationMs: r.durationMs ?? 0,
      createdAt: r.createdAt,
    }));
  } catch (error) {
    console.error("Failed to fetch pipeline logs:", error);
    return [];
  }
}

export async function logPipelineRun(data: { date: string; collected: number; failed: number; durationMs: number }) {
  try {
    await db.insert(pipelineLogs).values(data);
  } catch (error) {
    console.error("Failed to log pipeline run:", error);
  }
}

export async function getKeywordCategoryMatrix() {
  try {
    const rows = await db.select({
      keyword: sources.value,
      category: collectedData.category,
      cnt: count(),
    })
      .from(collectedData)
      .innerJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(and(isNotNull(collectedData.category), isNotNull(sources.value)))
      .groupBy(sources.value, collectedData.category)
      .orderBy(desc(count()))
      .limit(200);

    const kwTotals: Record<string, number> = {};
    for (const row of rows) {
      if (!row.keyword) continue;
      kwTotals[row.keyword] = (kwTotals[row.keyword] ?? 0) + Number(row.cnt);
    }
    const topKeywords = Object.entries(kwTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([kw]) => kw);

    const CATS = ['LLM推論', 'エージェント', 'ツール/フレームワーク', 'ハードウェア', 'ビジネス応用', '研究/論文', 'その他'];
    const maxCount = Math.max(1, ...rows.map(r => Number(r.cnt)));

    const matrix = topKeywords.map(kw => ({
      keyword: kw,
      data: CATS.map(cat => {
        const found = rows.find(r => r.keyword === kw && r.category === cat);
        return found ? Number(found.cnt) : 0;
      }),
    }));

    return { keywords: topKeywords, categories: CATS, matrix, maxCount };
  } catch (error) {
    console.error("Failed to fetch keyword category matrix:", error);
    return { keywords: [], categories: [], matrix: [], maxCount: 1 };
  }
}

// ─── データ操作 ───────────────────────────────────────────────────

export async function addSource(value: string, type: string = 'keyword') {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100) {
    return { success: false, message: 'キーワードは1〜100文字にしてください' };
  }
  try {
    await db.insert(sources).values({ type, value: trimmed, status: 'active', score: 0 }).onConflictDoNothing();
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error("Failed to add source:", error);
    return { success: false };
  }
}

export async function deleteSource(id: number) {
  try {
    await db.delete(sources).where(eq(sources.id, id));
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error("Failed to delete source:", error);
    return { success: false };
  }
}

export async function toggleFavorite(id: number, currentlyFavorited: boolean) {
  try {
    const newValue = currentlyFavorited ? 0 : 1;
    const [item] = await db.select({
      sourceId: collectedData.sourceId,
      title: collectedData.title,
      category: collectedData.category,
    }).from(collectedData).where(eq(collectedData.id, id)).limit(1);
    await db.update(collectedData).set({ isFavorited: newValue }).where(eq(collectedData.id, id));
    if (item?.sourceId) {
      await db.insert(adoptionLogs).values({ sourceId: item.sourceId, isAdopted: newValue });
      const delta = newValue === 1 ? 2.0 : -1.0;
      await db.update(sources)
        .set({ score: sql`MAX(0.0, COALESCE(${sources.score}, 0.0) + ${delta})` })
        .where(eq(sources.id, item.sourceId));
    }
    // お気に入り = 強いシグナル
    if (newValue === 1) {
      const kws = extractKeywords(item?.title ?? null, item?.category ?? null);
      const now = new Date().toISOString();
      for (const kw of kws) {
        await db.insert(userTopicWeights)
          .values({ keyword: kw, weight: 0.3, updatedAt: now })
          .onConflictDoUpdate({
            target: userTopicWeights.keyword,
            set: { weight: sql`${userTopicWeights.weight} + 0.3`, updatedAt: now },
          });
      }
    }
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error("Failed to toggle favorite:", error);
    return { success: false };
  }
}

export async function toggleReadLater(id: number, current: boolean) {
  try {
    await db.update(collectedData).set({ isReadLater: current ? 0 : 1 }).where(eq(collectedData.id, id));
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error("Failed to toggle read later:", error);
    return { success: false };
  }
}

export async function markAsRead(id: number, currentIsRead: boolean) {
  try {
    await db.update(collectedData).set({ isRead: currentIsRead ? 0 : 1 }).where(eq(collectedData.id, id));
    if (!currentIsRead) {
      const [item] = await db.select({
        sourceId: collectedData.sourceId,
        title: collectedData.title,
        category: collectedData.category,
      }).from(collectedData).where(eq(collectedData.id, id)).limit(1);

      if (item?.sourceId) {
        await db.update(sources)
          .set({ score: sql`COALESCE(${sources.score}, 0.0) + 0.3` })
          .where(eq(sources.id, item.sourceId));
      }
      // トピック重みを加算（読了 = 弱いシグナル）
      const kws = extractKeywords(item?.title ?? null, item?.category ?? null);
      const now = new Date().toISOString();
      for (const kw of kws) {
        await db.insert(userTopicWeights)
          .values({ keyword: kw, weight: 0.1, updatedAt: now })
          .onConflictDoUpdate({
            target: userTopicWeights.keyword,
            set: { weight: sql`${userTopicWeights.weight} + 0.1`, updatedAt: now },
          });
      }
    }
    return { success: true };
  } catch (error) {
    console.error("Failed to mark as read:", error);
    return { success: false };
  }
}

export async function getConflictingClaims(): Promise<ConflictingClaim[]> {
  try {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const rows = await db.select({
      id: claims.id,
      articleId: claims.articleId,
      subject: claims.subject,
      predicate: claims.predicate,
      value: claims.value,
      confidence: claims.confidence,
      createdAt: claims.createdAt,
      articleTitle: collectedData.title,
    })
      .from(claims)
      .leftJoin(collectedData, eq(claims.articleId, collectedData.id))
      .where(and(
        gte(claims.createdAt, twoWeeksAgo),
        eq(claims.confidence, 'high'),
      ))
      .orderBy(desc(claims.createdAt));

    // subject+predicateでグループ化して、値が複数あるものを矛盾として検出
    const groups = new Map<string, Claim[]>();
    for (const row of rows) {
      const key = `${row.subject}||${row.predicate}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row as Claim);
    }

    const conflicts: ConflictingClaim[] = [];
    for (const [key, clms] of groups) {
      const uniqueValues = new Set(clms.map(c => c.value.toLowerCase()));
      if (uniqueValues.size > 1) {
        const sepIdx = key.indexOf('||');
        conflicts.push({
          subject: key.slice(0, sepIdx),
          predicate: key.slice(sepIdx + 2),
          claims: clms.slice(0, 4),
        });
      }
    }

    return conflicts.slice(0, 5);
  } catch (error) {
    console.error("Failed to get conflicting claims:", error);
    return [];
  }
}

export async function getUserTopicWeights(): Promise<UserTopicWeight[]> {
  try {
    const rows = await db.select({ keyword: userTopicWeights.keyword, weight: userTopicWeights.weight })
      .from(userTopicWeights)
      .orderBy(desc(userTopicWeights.weight))
      .limit(10);
    return rows.map(r => ({ keyword: r.keyword, weight: r.weight ?? 0 }));
  } catch (error) {
    console.error("Failed to get user topic weights:", error);
    return [];
  }
}

export async function semanticSearch(query: string): Promise<CollectedItem[]> {
  const sanitized = query.trim().slice(0, 200);
  if (!sanitized) return [];
  try {
    const { text } = await generateText({
      model: google('gemini-2.5-flash-lite'),
      prompt: `以下の検索クエリを、DBのtitleとsummary検索に使える日本語・英語キーワード6個以内に展開してください。JSON配列のみ出力: ["kw1", "kw2", ...]
クエリ: ${sanitized}`,
    });

    let keywords: string[] = [sanitized];
    try {
      keywords = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch { /* fallback to original query */ }

    const conditions = keywords.slice(0, 6).flatMap(kw => [
      like(collectedData.title, `%${kw}%`),
      like(collectedData.summary, `%${kw}%`),
    ]);

    if (conditions.length === 0) return [];

    const rows = await db.select(COLLECTED_SELECT)
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(or(...conditions))
      .orderBy(desc(collectedData.createdAt))
      .limit(50);

    return parseCollectedRows(rows);
  } catch (error) {
    console.error("Semantic search failed:", error);
    return [];
  }
}
