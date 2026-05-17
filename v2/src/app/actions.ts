'use server';

import { db } from '@/db';
import { sources, collectedData, reports, adoptionLogs } from '@/db/schema';
import { desc, eq, count, gte, sql, like, or, isNotNull, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

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

export async function addSource(value: string, type: string = 'keyword') {
  try {
    await db.insert(sources).values({ type, value: value.trim(), status: 'active', score: 0 }).onConflictDoNothing();
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

export async function getCollectedDataList() {
  try {
    return await db.select({
      id: collectedData.id,
      title: collectedData.title,
      url: collectedData.url,
      summary: collectedData.summary,
      category: collectedData.category,
      isFavorited: collectedData.isFavorited,
      isReadLater: collectedData.isReadLater,
      importanceScore: collectedData.importanceScore,
      publishedAt: collectedData.publishedAt,
      createdAt: collectedData.createdAt,
      sourceValue: sources.value,
      sourceType: sources.type,
    })
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .orderBy(desc(collectedData.createdAt))
      .limit(100);
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

export async function toggleFavorite(id: number, currentlyFavorited: boolean) {
  try {
    const newValue = currentlyFavorited ? 0 : 1;
    const [item] = await db.select({ sourceId: collectedData.sourceId }).from(collectedData).where(eq(collectedData.id, id)).limit(1);
    await db.update(collectedData).set({ isFavorited: newValue }).where(eq(collectedData.id, id));
    if (item?.sourceId) {
      await db.insert(adoptionLogs).values({ sourceId: item.sourceId, isAdopted: newValue });
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

export async function semanticSearch(query: string) {
  if (!query.trim()) return [];
  try {
    const { text } = await generateText({
      model: google('gemini-2.5-flash-lite'),
      prompt: `以下の検索クエリを、DBのtitleとsummary検索に使える日本語・英語キーワード6個以内に展開してください。JSON配列のみ出力: ["kw1", "kw2", ...]
クエリ: ${query}`,
    });

    let keywords: string[] = [query];
    try {
      keywords = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch { /* fallback to original query */ }

    const conditions = keywords.slice(0, 6).flatMap(kw => [
      like(collectedData.title, `%${kw}%`),
      like(collectedData.summary, `%${kw}%`),
    ]);

    if (conditions.length === 0) return [];

    return await db.select({
      id: collectedData.id,
      title: collectedData.title,
      url: collectedData.url,
      summary: collectedData.summary,
      category: collectedData.category,
      isFavorited: collectedData.isFavorited,
      isReadLater: collectedData.isReadLater,
      importanceScore: collectedData.importanceScore,
      publishedAt: collectedData.publishedAt,
      createdAt: collectedData.createdAt,
      sourceValue: sources.value,
      sourceType: sources.type,
    })
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(or(...conditions))
      .orderBy(desc(collectedData.createdAt))
      .limit(50);
  } catch (error) {
    console.error("Semantic search failed:", error);
    return [];
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
