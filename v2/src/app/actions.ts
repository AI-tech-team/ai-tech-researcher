'use server';

import { db } from '@/db';
import { sources, collectedData, reports, adoptionLogs } from '@/db/schema';
import { desc, eq, count, gte, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function getReportsData() {
  try {
    const data = await db.select().from(reports).orderBy(desc(reports.createdAt));
    return data;
  } catch (error) {
    console.error("Failed to fetch reports:", error);
    return [];
  }
}

export async function getSourcesData() {
  try {
    const data = await db.select().from(sources).orderBy(desc(sources.score));
    return data;
  } catch (error) {
    console.error("Failed to fetch sources:", error);
    return [];
  }
}

export async function addSource(value: string, type: string = 'keyword') {
  try {
    await db.insert(sources).values({
      type,
      value: value.trim(),
      status: 'active',
      score: 0,
    }).onConflictDoNothing();
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
    const data = await db
      .select({
        id: collectedData.id,
        title: collectedData.title,
        url: collectedData.url,
        summary: collectedData.summary,
        category: collectedData.category,
        isFavorited: collectedData.isFavorited,
        publishedAt: collectedData.publishedAt,
        createdAt: collectedData.createdAt,
        sourceValue: sources.value,
        sourceType: sources.type,
      })
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .orderBy(desc(collectedData.createdAt))
      .limit(100);
    return data;
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

    const [item] = await db
      .select({ sourceId: collectedData.sourceId })
      .from(collectedData)
      .where(eq(collectedData.id, id))
      .limit(1);

    await db.update(collectedData)
      .set({ isFavorited: newValue })
      .where(eq(collectedData.id, id));

    if (item?.sourceId) {
      await db.insert(adoptionLogs).values({
        sourceId: item.sourceId,
        isAdopted: newValue,
      });
    }

    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error("Failed to toggle favorite:", error);
    return { success: false };
  }
}

export async function getSourcePerformance() {
  try {
    const data = await db.select({
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
    return data;
  } catch (error) {
    console.error("Failed to fetch source performance:", error);
    return [];
  }
}
