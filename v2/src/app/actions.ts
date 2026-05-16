'use server';

import { db } from '@/db';
import { sources, collectedData, reports } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
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
    // 収集データとソースを結合して取得
    const data = await db
      .select({
        id: collectedData.id,
        title: collectedData.title,
        url: collectedData.url,
        summary: collectedData.summary,
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
