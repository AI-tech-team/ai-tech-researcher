'use server';

import { db, client } from '@/db';
import { sources, collectedData, reports, adoptionLogs, pipelineLogs, claims, userTopicWeights, benchmarks, relations, entities, alerts, readingEvents } from '@/db/schema';
import { desc, asc, eq, count, gte, lte, sql, like, or, isNotNull, and, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { google } from '@ai-sdk/google';
import { generateText, embedMany } from 'ai';
import { cached } from '@/lib/cache';
import type { CollectedItem, PipelineLog, TrendingKeyword, Claim, ConflictingClaim, UserTopicWeight, BenchmarkLeaderboard, BenchmarkEntry, KnowledgeRelation, BenchmarkAlert, KnowledgeStats, BriefingReport, AlertItem, ResearchBrief, ReadingProfile, TopicCluster } from '@/types';

// 読書DNA: カテゴリ→4軸の寄与（depth:0理論↔100実装 / view:0研究者↔50エンジニア↔100ビジネス / recency:0長期↔100近未来）
const CAT_AXIS: Record<string, { depth: number; view: number; recency: number }> = {
  '研究/論文':            { depth: 5,  view: 5,  recency: 25 },
  'LLM推論':              { depth: 70, view: 45, recency: 60 },
  'エージェント':          { depth: 75, view: 50, recency: 65 },
  'ツール/フレームワーク': { depth: 95, view: 45, recency: 60 },
  'ハードウェア':          { depth: 55, view: 50, recency: 55 },
  'ビジネス応用':          { depth: 40, view: 95, recency: 75 },
  'その他':               { depth: 50, view: 50, recency: 50 },
};

// created_at等はSQLiteのCURRENT_TIMESTAMP（"YYYY-MM-DD HH:MM:SS" 空白区切り）で格納される。
// 比較しきい値もこの形式に揃える（ISOの"T"/"Z"だと文字列比較で境界1日分ずれるため）。
function sqlTs(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

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
  titleJa: collectedData.titleJa,
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

// 読書DNA: 記事行動を記録（4軸プロファイルの元データ）
async function logReadingEvent(articleId: number, action: string, weight: number, category: string | null) {
  try {
    await db.insert(readingEvents).values({ articleId, action, weight, category });
  } catch (e) {
    console.error('Failed to log reading event:', e);
  }
}

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
    // briefing/learning_recap/cross_insightはメール/インサイト専用なので調査レポート一覧からは除外
    return await db.select().from(reports)
      .where(sql`${reports.type} NOT IN ('briefing', 'learning_recap', 'cross_insight')`)
      .orderBy(desc(reports.createdAt));
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

function urlDomain(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

export async function getCollectedDataList(): Promise<CollectedItem[]> {
  try {
    const rows = await db.select(COLLECTED_SELECT)
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .orderBy(desc(collectedData.createdAt))
      .limit(100);
    const items = parseCollectedRows(rows);

    // 複数媒体が報じたストーリーについて、媒体（ドメイン）一覧を付与
    const multiStoryIds = [...new Set(
      items.filter(i => (i.storyCount ?? 1) > 1 && i.storyId != null).map(i => i.storyId as number)
    )];
    if (multiStoryIds.length > 0) {
      const members = await db.select({
        storyId: collectedData.storyId,
        url: collectedData.url,
        sourceValue: sources.value,
      })
        .from(collectedData)
        .leftJoin(sources, eq(collectedData.sourceId, sources.id))
        .where(inArray(collectedData.storyId, multiStoryIds));

      const outletMap = new Map<number, string[]>();
      for (const m of members) {
        if (m.storyId == null) continue;
        const outlet = urlDomain(m.url) ?? m.sourceValue ?? null;
        if (!outlet) continue;
        const list = outletMap.get(m.storyId) ?? [];
        if (!list.includes(outlet)) list.push(outlet);
        outletMap.set(m.storyId, list);
      }
      for (const item of items) {
        if (item.storyId != null && outletMap.has(item.storyId)) {
          item.storyOutlets = outletMap.get(item.storyId);
        }
      }
    }
    return items;
  } catch (error) {
    console.error("Failed to fetch collected data:", error);
    return [];
  }
}

export async function getActivityData() {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // JST基準で集計（createdAtはUTC格納。+9hでJST日付に揃え、ラベルもJSTで生成）
    const rows = await db.select({
      date: sql<string>`strftime('%Y-%m-%d', ${collectedData.createdAt}, '+9 hours')`.as('date'),
      cnt: count(),
    })
      .from(collectedData)
      .where(gte(collectedData.createdAt, sqlTs(sevenDaysAgo)))
      .groupBy(sql`strftime('%Y-%m-%d', ${collectedData.createdAt}, '+9 hours')`);

    const result: { name: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const name = d.toLocaleDateString('ja-JP', { weekday: 'short', timeZone: 'Asia/Tokyo' });
      const found = rows.find(r => r.date === dateStr);
      result.push({ name, count: found ? Number(found.cnt) : 0 });
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
    // 収集数・重要度avg・お気に入り・後で読む（実際のユーザー価値シグナル）
    const rows = await db.select({
      id: sources.id,
      value: sources.value,
      type: sources.type,
      status: sources.status,
      score: sources.score,
      lastHitAt: sources.lastHitAt,
      collectedCount: sql<number>`COUNT(${collectedData.id})`.as('collected_count'),
      avgImportance: sql<number>`COALESCE(AVG(${collectedData.importanceScore}), 5)`.as('avg_importance'),
      favoritedCount: sql<number>`COALESCE(SUM(${collectedData.isFavorited}), 0)`.as('favorited_count'),
      readLaterCount: sql<number>`COALESCE(SUM(${collectedData.isReadLater}), 0)`.as('readlater_count'),
    })
      .from(sources)
      .leftJoin(collectedData, eq(collectedData.sourceId, sources.id))
      .where(sql`${sources.status} != 'stopped'`)
      .groupBy(sources.id)
      .limit(80);

    // レポート採用数（最も強い価値シグナル）
    const adoptRows = await db.select({ sourceId: adoptionLogs.sourceId, cnt: count() })
      .from(adoptionLogs)
      .where(eq(adoptionLogs.isAdopted, 1))
      .groupBy(adoptionLogs.sourceId);
    const adoptMap = new Map(adoptRows.map(a => [a.sourceId, Number(a.cnt)]));

    return rows.map(r => {
      const collected = Number(r.collectedCount);
      const adopted = adoptMap.get(r.id) ?? 0;
      const favorited = Number(r.favoritedCount);
      const readLater = Number(r.readLaterCount);
      // 貢献度: 実際に役立った度合い（採用×3 + お気に入り×2 + 後で読む×1）
      const contribution = adopted * 3 + favorited * 2 + readLater;
      // 採用率（収集のうちレポート採用された割合）
      const adoptionRate = collected > 0 ? Math.round((adopted / collected) * 100) : 0;
      return {
        ...r,
        collectedCount: collected,
        avgImportance: Number(r.avgImportance),
        adoptedCount: adopted,
        favoritedCount: favorited,
        readLaterCount: readLater,
        adoptionRate,
        contribution,
        roi: contribution, // 後方互換
      };
    }).sort((a, b) => b.contribution - a.contribution || b.collectedCount - a.collectedCount)
      .slice(0, 50);
  } catch (error) {
    console.error("Failed to fetch source ROI:", error);
    return [];
  }
}

export async function getCategoryTrendData() {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // JST基準で集計（+9hでJST日付に統一、ラベルもJSTで生成）
    const rows = await db.select({
      date: sql<string>`strftime('%Y-%m-%d', ${collectedData.createdAt}, '+9 hours')`,
      category: collectedData.category,
      cnt: count(),
    })
      .from(collectedData)
      .where(gte(collectedData.createdAt, sqlTs(sevenDaysAgo)))
      .groupBy(sql`strftime('%Y-%m-%d', ${collectedData.createdAt}, '+9 hours')`, collectedData.category);

    const CATS = ['LLM推論', 'エージェント', 'ツール/フレームワーク', 'ハードウェア', 'ビジネス応用', '研究/論文', 'その他'];

    const result: any[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const md = d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' });
      const entry: any = { name: md };
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
 return cached('modelMentions', 180_000, async () => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const rows = await db.select({ summary: collectedData.summary, title: collectedData.title })
      .from(collectedData)
      .where(gte(collectedData.createdAt, sqlTs(thirtyDaysAgo)));

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
 });
}

export async function getTrendingKeywords(): Promise<TrendingKeyword[]> {
  try {
    const now = new Date();
    const sevenDaysAgo = sqlTs(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    const fourteenDaysAgo = sqlTs(new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000));

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
 return cached('kwMatrix', 180_000, async () => {
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
 });
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
      await logReadingEvent(id, 'favorite', 3, item?.category ?? null);
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
    if (!current) {
      const [item] = await db.select({ category: collectedData.category })
        .from(collectedData).where(eq(collectedData.id, id)).limit(1);
      await logReadingEvent(id, 'readlater', 1, item?.category ?? null);
    }
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
      await logReadingEvent(id, 'read', 2, item?.category ?? null);
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
    const twoWeeksAgo = sqlTs(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));

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
        eq(claims.status, 'active'),   // stale(陳腐化済み)は論点から除外
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

// ─── v3知識グラフ ───────────────────────────────────────────────────

export async function getBenchmarkLeaderboards(): Promise<BenchmarkLeaderboard[]> {
  try {
    const rows = await db.select({
      benchmarkName: benchmarks.benchmarkName,
      entityName: benchmarks.entityName,
      score: benchmarks.score,
      unit: benchmarks.unit,
      recordedDate: benchmarks.recordedDate,
      sourceUrl: benchmarks.sourceUrl,
      confidence: benchmarks.confidence,
    })
      .from(benchmarks)
      .orderBy(desc(benchmarks.recordedDate), desc(benchmarks.createdAt))
      .limit(800);

    const byBench = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!byBench.has(r.benchmarkName)) byBench.set(r.benchmarkName, []);
      byBench.get(r.benchmarkName)!.push(r);
    }

    const result: BenchmarkLeaderboard[] = [];
    for (const [benchmarkName, recs] of byBench) {
      // エンティティごとのスコア履歴（日付降順）
      const entityScores = new Map<string, number[]>();
      for (const r of recs) {
        const arr = entityScores.get(r.entityName) ?? [];
        arr.push(r.score);
        entityScores.set(r.entityName, arr);
      }
      // エンティティごとの最新スコア（recsは日付降順なので最初に出たものが最新）
      const latestByEntity = new Map<string, BenchmarkEntry>();
      for (const r of recs) {
        if (!latestByEntity.has(r.entityName)) {
          const scores = entityScores.get(r.entityName)!;
          const trend: BenchmarkEntry['trend'] = scores.length < 2
            ? 'new'
            : scores[0] > scores[1] ? 'up' : scores[0] < scores[1] ? 'down' : 'flat';
          latestByEntity.set(r.entityName, {
            entityName: r.entityName, score: r.score, unit: r.unit,
            recordedDate: r.recordedDate, sourceUrl: r.sourceUrl, confidence: r.confidence, trend,
          });
        }
      }
      const entries = [...latestByEntity.values()].sort((a, b) => b.score - a.score);
      if (entries.length < 2) continue; // リーダーボードは2エンティティ以上

      const topEntities = entries.slice(0, 5).map(e => e.entityName);
      const topSet = new Set(topEntities);
      const dateMap = new Map<string, Record<string, number | string>>();
      for (const r of [...recs].reverse()) { // 時系列昇順
        if (!topSet.has(r.entityName)) continue;
        const d = r.recordedDate ?? '';
        if (!d) continue;
        if (!dateMap.has(d)) dateMap.set(d, { date: d });
        dateMap.get(d)![r.entityName] = r.score;
      }
      const series = [...dateMap.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));

      result.push({ benchmarkName, unit: entries[0].unit, entries, series, topEntities });
    }

    return result.sort((a, b) => b.entries.length - a.entries.length).slice(0, 12);
  } catch (error) {
    console.error('Failed to fetch benchmark leaderboards:', error);
    return [];
  }
}

export async function getKnowledgeRelations(): Promise<KnowledgeRelation[]> {
  try {
    const rows = await db.select({
      id: relations.id,
      subjectName: relations.subjectName,
      relationType: relations.relationType,
      objectName: relations.objectName,
      confidence: relations.confidence,
      status: relations.status,
      validFrom: relations.validFrom,
    })
      .from(relations)
      .orderBy(
        sql`CASE ${relations.status} WHEN 'active' THEN 0 WHEN 'inferred' THEN 1 ELSE 2 END`,
        desc(relations.validFrom),
      )
      .limit(80);
    return rows;
  } catch (error) {
    console.error('Failed to fetch relations:', error);
    return [];
  }
}

export async function getBenchmarkAlerts(): Promise<BenchmarkAlert[]> {
  try {
    const rows = await db.select({
      benchmarkName: benchmarks.benchmarkName,
      entityName: benchmarks.entityName,
      score: benchmarks.score,
      recordedDate: benchmarks.recordedDate,
    })
      .from(benchmarks)
      .orderBy(asc(benchmarks.benchmarkName), asc(benchmarks.recordedDate), asc(benchmarks.createdAt))
      .limit(800);

    const alerts: BenchmarkAlert[] = [];
    let curBench = '';
    let maxScore = -Infinity;
    let leader = '';
    for (const r of rows) {
      if (r.benchmarkName !== curBench) {
        curBench = r.benchmarkName; maxScore = -Infinity; leader = '';
      }
      if (r.score > maxScore) {
        // 別エンティティが既存リーダーを上回ったらリード交代アラート
        if (leader && r.entityName !== leader) {
          alerts.push({
            benchmarkName: r.benchmarkName,
            newLeader: r.entityName,
            prevLeader: leader,
            newScore: r.score,
            prevScore: maxScore,
            date: r.recordedDate,
          });
        }
        maxScore = r.score;
        leader = r.entityName;
      }
    }
    return alerts
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
      .slice(0, 10);
  } catch (error) {
    console.error('Failed to fetch benchmark alerts:', error);
    return [];
  }
}

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  try {
    const [ent, bench, rel, staleRel] = await Promise.all([
      db.select({ c: count() }).from(entities),
      db.select({ c: count() }).from(benchmarks),
      db.select({ c: count() }).from(relations),
      db.select({ c: count() }).from(relations).where(eq(relations.status, 'stale')),
    ]);
    return {
      entities: Number(ent[0]?.c ?? 0),
      benchmarks: Number(bench[0]?.c ?? 0),
      relations: Number(rel[0]?.c ?? 0),
      staleRelations: Number(staleRel[0]?.c ?? 0),
    };
  } catch (error) {
    console.error('Failed to fetch knowledge stats:', error);
    return { entities: 0, benchmarks: 0, relations: 0, staleRelations: 0 };
  }
}

// ─── v5: 生きた知識ページ（エンティティ単位の統合ビュー）────────────────
export interface EntityListItem { id: number; name: string; type: string | null; mentions: number; }

export async function getKnowledgeEntities(): Promise<EntityListItem[]> {
  try {
    const rows = await db.select({
      id: entities.id, name: entities.canonicalName, type: entities.type, mentions: entities.mentionCount,
    }).from(entities).orderBy(desc(entities.mentionCount)).limit(48);
    return rows.map(r => ({ id: r.id, name: r.name, type: r.type, mentions: Number(r.mentions ?? 0) }));
  } catch (error) {
    console.error('Failed to fetch entities:', error);
    return [];
  }
}

export interface EntityPage {
  name: string;
  type: string | null;
  benchmarks: { benchmark: string; score: number; unit: string | null; date: string | null }[];
  relations: { dir: 'out' | 'in'; type: string; other: string }[];
  claims: { predicate: string; value: string }[];
  articles: { id: number; title: string; category: string | null; importance: number }[];
}

export async function getEntityKnowledgePage(name: string): Promise<EntityPage | null> {
  try {
    const ent = await db.select({ name: entities.canonicalName, type: entities.type })
      .from(entities).where(sql`LOWER(${entities.canonicalName}) = ${name.toLowerCase()}`).limit(1);
    const canonical = ent[0]?.name ?? name;
    const type = ent[0]?.type ?? null;

    const [bench, relsOut, relsIn, clm, claimArts, benchArts] = await Promise.all([
      db.select({ benchmark: benchmarks.benchmarkName, score: benchmarks.score, unit: benchmarks.unit, date: benchmarks.recordedDate })
        .from(benchmarks).where(eq(benchmarks.entityName, canonical)).orderBy(desc(benchmarks.recordedDate)).limit(12),
      db.select({ type: relations.relationType, other: relations.objectName })
        .from(relations).where(and(eq(relations.subjectName, canonical), sql`${relations.status} != 'stale'`)).limit(20),
      db.select({ type: relations.relationType, other: relations.subjectName })
        .from(relations).where(and(eq(relations.objectName, canonical), sql`${relations.status} != 'stale'`)).limit(20),
      db.select({ predicate: claims.predicate, value: claims.value })
        .from(claims).where(and(eq(claims.subject, canonical), eq(claims.status, 'active'))).orderBy(desc(claims.validFrom)).limit(8),
      db.select({ aid: claims.articleId }).from(claims).where(eq(claims.subject, canonical)).limit(40),
      db.select({ aid: benchmarks.articleId }).from(benchmarks).where(eq(benchmarks.entityName, canonical)).limit(40),
    ]);

    const ids = [...new Set([...claimArts, ...benchArts].map(r => r.aid).filter((x): x is number => x != null))];
    let articles: EntityPage['articles'] = [];
    if (ids.length > 0) {
      const arts = await db.select({
        id: collectedData.id, title: collectedData.title, titleJa: collectedData.titleJa,
        category: collectedData.category, imp: collectedData.importanceScore,
      }).from(collectedData).where(inArray(collectedData.id, ids)).orderBy(desc(collectedData.importanceScore)).limit(12);
      articles = arts.map(a => ({ id: a.id, title: a.titleJa || a.title || '無題', category: a.category, importance: a.imp ?? 5 }));
    }

    return {
      name: canonical,
      type,
      benchmarks: bench.map(b => ({ benchmark: b.benchmark, score: b.score, unit: b.unit, date: b.date })),
      relations: [
        ...relsOut.map(r => ({ dir: 'out' as const, type: r.type, other: r.other })),
        ...relsIn.map(r => ({ dir: 'in' as const, type: r.type, other: r.other })),
      ],
      claims: clm.map(c => ({ predicate: c.predicate, value: c.value })),
      articles,
    };
  } catch (error) {
    console.error('getEntityKnowledgePage failed:', error);
    return null;
  }
}

// ─── v3自律リサーチ ─────────────────────────────────────────────────

export async function getBriefing(): Promise<BriefingReport | null> {
  try {
    const rows = await db.select({
      id: reports.id, content: reports.content, reportDate: reports.reportDate, createdAt: reports.createdAt,
    })
      .from(reports)
      .where(eq(reports.type, 'briefing'))
      .orderBy(desc(reports.createdAt))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to fetch briefing:', error);
    return null;
  }
}

export async function getCrossInsight(): Promise<BriefingReport | null> {
  try {
    const rows = await db.select({
      id: reports.id, content: reports.content, reportDate: reports.reportDate, createdAt: reports.createdAt,
    })
      .from(reports)
      .where(eq(reports.type, 'cross_insight'))
      .orderBy(desc(reports.createdAt))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to fetch cross insight:', error);
    return null;
  }
}

export async function getActiveAlerts(): Promise<AlertItem[]> {
  try {
    return await db.select({
      id: alerts.id, type: alerts.type, title: alerts.title, reason: alerts.reason,
      entityName: alerts.entityName, severity: alerts.severity,
      relatedArticleId: alerts.relatedArticleId, createdAt: alerts.createdAt,
    })
      .from(alerts)
      .where(eq(alerts.status, 'active'))
      .orderBy(
        sql`CASE ${alerts.severity} WHEN 'high' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END`,
        desc(alerts.createdAt),
      )
      .limit(30);
  } catch (error) {
    console.error('Failed to fetch alerts:', error);
    return [];
  }
}

export async function dismissAlert(id: number) {
  try {
    await db.update(alerts).set({ status: 'dismissed' }).where(eq(alerts.id, id));
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to dismiss alert:', error);
    return { success: false };
  }
}

export async function generateResearchBrief(topic: string): Promise<ResearchBrief | null> {
  const t = topic.trim().slice(0, 120);
  if (!t) return null;
  try {
    // 1. ベクトル検索でDB内の関連記事を取得（埋め込み基盤を活用）
    let related: { title: string; url: string | null }[] = [];
    try {
      const { embeddings } = await embedMany({
        model: google.embedding('gemini-embedding-001'),
        values: [t],
        providerOptions: { google: { outputDimensionality: 768, taskType: 'RETRIEVAL_QUERY' } },
      });
      const res = await client.execute({
        sql: `SELECT tt.title AS title, tt.url AS url
              FROM vector_top_k('collected_embedding_idx', vector32(?), 8) AS v
              JOIN collected_data tt ON tt.rowid = v.id`,
        args: [JSON.stringify(embeddings[0])],
      });
      related = res.rows.map(r => ({ title: (r.title as string) ?? '', url: (r.url as string | null) ?? null }));
    } catch {
      console.warn('ベクトル関連記事の取得に失敗、Groundingのみで続行');
    }

    const ctx = related.length
      ? `\n\n【DB内の関連記事（参考）】\n${related.map(r => `- ${r.title}`).join('\n')}`
      : '';

    // 2. Grounding付きで構造化リサーチブリーフを生成
    const { text } = await generateText({
      model: google('gemini-2.5-flash'),
      tools: { google_search: google.tools.googleSearch({}) },
      system: `あなたはAI技術リサーチャーです。指定トピックについて最新情報を検索しつつ、Markdownでリサーチブリーフを作成してください。
必須セクション（この見出しのまま）:
## 定義
## 現状
## 主要プレイヤー
## 直近の動向
## 未解決の課題
## 関連して読むべきもの
各セクションは簡潔に、具体的な固有名詞・数値・モデル名を含める。全体1200〜1800字。`,
      prompt: `トピック: ${t}${ctx}`,
    });

    return { topic: t, content: text, relatedArticles: related };
  } catch (error) {
    console.error('Failed to generate research brief:', error);
    return null;
  }
}

export async function getReadingProfile(): Promise<ReadingProfile | null> {
  try {
    const now = Date.now();
    const thirtyAgo = sqlTs(new Date(now - 30 * 24 * 60 * 60 * 1000));
    const sixtyAgo = sqlTs(new Date(now - 60 * 24 * 60 * 60 * 1000));
    const twentyOneAgo = sqlTs(new Date(now - 21 * 24 * 60 * 60 * 1000));

    const events = await db.select({
      category: readingEvents.category,
      weight: readingEvents.weight,
      createdAt: readingEvents.createdAt,
    }).from(readingEvents).orderBy(desc(readingEvents.createdAt)).limit(1000);

    if (events.length === 0) return null;

    // 重み付き4軸の集計
    let wSum = 0, depthSum = 0, viewSum = 0, recencySum = 0;
    const catCount = new Map<string, number>();
    const last30 = new Map<string, number>();
    const prior30 = new Map<string, number>();
    const recentCats = new Set<string>();

    for (const e of events) {
      const cat = e.category ?? 'その他';
      const w = e.weight ?? 1;
      const ax = CAT_AXIS[cat] ?? CAT_AXIS['その他'];
      wSum += w;
      depthSum += ax.depth * w;
      viewSum += ax.view * w;
      recencySum += ax.recency * w;
      catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
      const ts = e.createdAt ?? '';
      if (ts >= thirtyAgo) { last30.set(cat, (last30.get(cat) ?? 0) + 1); }
      else if (ts >= sixtyAgo) { prior30.set(cat, (prior30.get(cat) ?? 0) + 1); }
      if (ts >= twentyOneAgo) recentCats.add(cat);
    }

    const depth = wSum ? Math.round(depthSum / wSum) : 50;
    const view = wSum ? Math.round(viewSum / wSum) : 50;
    const recency = wSum ? Math.round(recencySum / wSum) : 50;

    // 広さ: カテゴリ分布のエントロピーを正規化（0=特化, 100=広範）
    const counts = [...catCount.values()];
    const total = counts.reduce((a, b) => a + b, 0);
    let entropy = 0;
    for (const c of counts) { const p = c / total; entropy -= p * Math.log2(p); }
    const maxEntropy = Math.log2(Math.max(2, Object.keys(CAT_AXIS).length));
    const breadth = Math.round((entropy / maxEntropy) * 100);

    const radar = [
      { axis: '深さ',  leftLabel: '理論派',   rightLabel: '実装派',     value: depth },
      { axis: '視点',  leftLabel: '研究者',   rightLabel: 'ビジネス',   value: view },
      { axis: '広さ',  leftLabel: '専門特化', rightLabel: '広範収集',   value: breadth },
      { axis: '時制',  leftLabel: '長期志向', rightLabel: '近未来志向', value: recency },
    ];

    const categoryDistribution = [...catCount.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    // 関心シフト（直近30日 vs その前30日）
    const shiftCats = new Set([...last30.keys(), ...prior30.keys()]);
    const recentShift = [...shiftCats]
      .map(category => {
        const delta = (last30.get(category) ?? 0) - (prior30.get(category) ?? 0);
        return { category, delta, direction: (delta >= 0 ? 'up' : 'down') as 'up' | 'down' };
      })
      .filter(s => s.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 4);

    // 最近読んでいない分野（過去に読んだが直近21日engagementなし）
    const neglectedCategories = [...catCount.keys()].filter(c => !recentCats.has(c) && c !== 'その他');

    // ペルソナ（一言）
    const depthWord = depth >= 65 ? '実装重視' : depth <= 35 ? '理論重視' : 'バランス型';
    const viewWord = view >= 70 ? 'ビジネス視点' : view <= 35 ? '研究者視点' : 'エンジニア視点';
    const breadthWord = breadth >= 60 ? '広く収集' : breadth <= 35 ? '専門特化' : '';
    const persona = [depthWord, viewWord, breadthWord].filter(Boolean).join('・');

    return { totalEvents: events.length, radar, categoryDistribution, recentShift, neglectedCategories, persona };
  } catch (error) {
    console.error('Failed to compute reading profile:', error);
    return null;
  }
}

// クエリを埋め込み、ベクトル近傍検索（旧: Geminiキーワード展開＋LIKE）
export async function semanticSearch(query: string): Promise<CollectedItem[]> {
  const sanitized = query.trim().slice(0, 200);
  if (!sanitized) return [];
  try {
    const { embeddings } = await embedMany({
      model: google.embedding('gemini-embedding-001'),
      values: [sanitized],
      providerOptions: { google: { outputDimensionality: 768, taskType: 'RETRIEVAL_QUERY' } },
    });
    const vecStr = JSON.stringify(embeddings[0]);
    const nn = await client.execute({
      sql: `SELECT cd.id AS id, vector_distance_cos(cd.embedding, vector32(?)) AS dist
            FROM vector_top_k('collected_embedding_idx', vector32(?), 50) AS v
            JOIN collected_data cd ON cd.rowid = v.id
            ORDER BY dist ASC`,
      args: [vecStr, vecStr],
    });
    const ids = nn.rows.map(r => Number(r.id));
    if (ids.length === 0) {
      // 埋め込み未生成等のフォールバック: 部分一致
      const rows = await db.select(COLLECTED_SELECT)
        .from(collectedData)
        .leftJoin(sources, eq(collectedData.sourceId, sources.id))
        .where(or(like(collectedData.title, `%${sanitized}%`), like(collectedData.summary, `%${sanitized}%`)))
        .orderBy(desc(collectedData.createdAt))
        .limit(50);
      return parseCollectedRows(rows);
    }
    const rows = await db.select(COLLECTED_SELECT)
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(inArray(collectedData.id, ids));
    const order = new Map(ids.map((id, i) => [id, i]));
    return parseCollectedRows(rows).sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  } catch (error) {
    console.error('Semantic search failed:', error);
    return [];
  }
}

// 今週の話題の塊（複数記事が報じたトピック = story_idで束ねたもの）
export async function getTopicClusters(): Promise<TopicCluster[]> {
  try {
    const sevenAgo = sqlTs(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const groups = await db.select({
      storyId: collectedData.storyId,
      size: count(),
      importance: sql<number>`SUM(${collectedData.importanceScore})`,
    })
      .from(collectedData)
      .where(and(gte(collectedData.createdAt, sevenAgo), isNotNull(collectedData.storyId)))
      .groupBy(collectedData.storyId)
      .having(sql`COUNT(*) >= 2`)
      .orderBy(desc(count()), desc(sql`SUM(${collectedData.importanceScore})`))
      .limit(6);
    if (groups.length === 0) return [];

    const storyIds = groups.map(g => g.storyId as number);
    const members = await db.select({
      storyId: collectedData.storyId,
      id: collectedData.id,
      title: collectedData.title,
      titleJa: collectedData.titleJa,
      url: collectedData.url,
      category: collectedData.category,
      importanceScore: collectedData.importanceScore,
    })
      .from(collectedData)
      .where(inArray(collectedData.storyId, storyIds))
      .orderBy(desc(collectedData.importanceScore));

    const byStory = new Map<number, typeof members>();
    for (const m of members) {
      if (m.storyId == null) continue;
      const arr = byStory.get(m.storyId) ?? [];
      arr.push(m);
      byStory.set(m.storyId, arr);
    }

    return groups.map(g => {
      const ms = byStory.get(g.storyId as number) ?? [];
      const head = ms[0];
      return {
        storyId: g.storyId as number,
        headline: (head?.titleJa || head?.title) ?? '無題',
        size: Number(g.size),
        category: head?.category ?? null,
        importance: Number(g.importance),
        members: ms.slice(0, 5).map(m => ({ id: m.id, title: (m.titleJa || m.title) ?? '無題', url: m.url })),
      };
    });
  } catch (error) {
    console.error('Failed to fetch topic clusters:', error);
    return [];
  }
}

// 読書DNA連動の推薦: エンゲージ記事の重心に近い「未読・未お気に入り」記事
export async function getRecommendations(): Promise<CollectedItem[]> {
  try {
    const ev = await db.select({ articleId: readingEvents.articleId })
      .from(readingEvents).orderBy(desc(readingEvents.createdAt)).limit(40);
    const engagedIds = [...new Set(ev.map(e => e.articleId).filter((v): v is number => v != null))];
    if (engagedIds.length < 2) return [];

    const embRes = await client.execute({
      sql: `SELECT vector_extract(embedding) AS emb FROM collected_data
            WHERE embedding IS NOT NULL AND id IN (${engagedIds.map(() => '?').join(',')})`,
      args: engagedIds,
    });
    const vecs = embRes.rows.map(r => { try { return JSON.parse(r.emb as string) as number[]; } catch { return null; } })
      .filter((v): v is number[] => Array.isArray(v) && v.length > 0);
    if (vecs.length === 0) return [];

    const dim = vecs[0].length;
    const centroid = new Array(dim).fill(0);
    for (const v of vecs) for (let i = 0; i < dim; i++) centroid[i] += v[i];
    for (let i = 0; i < dim; i++) centroid[i] /= vecs.length;

    const nn = await client.execute({
      sql: `SELECT cd.id AS id FROM vector_top_k('collected_embedding_idx', vector32(?), 40) AS v
            JOIN collected_data cd ON cd.rowid = v.id
            WHERE cd.is_read = 0 AND cd.is_favorited = 0`,
      args: [JSON.stringify(centroid)],
    });
    const engagedSet = new Set(engagedIds);
    const recIds = nn.rows.map(r => Number(r.id)).filter(id => !engagedSet.has(id)).slice(0, 8);
    if (recIds.length === 0) return [];

    const rows = await db.select(COLLECTED_SELECT)
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(inArray(collectedData.id, recIds));
    const order = new Map(recIds.map((id, i) => [id, i]));
    return parseCollectedRows(rows).sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  } catch (error) {
    console.error('Failed to fetch recommendations:', error);
    return [];
  }
}
