import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import { db } from '@/db';
import { sources, collectedData, adoptionLogs } from '@/db/schema';
import { eq, sql, desc, count, gte, and } from 'drizzle-orm';
import { withRetry } from '@/lib/llm';

const KeywordsSchema = z.object({ keywords: z.array(z.string().min(2).max(60)).max(5) });

const DOMAIN_SKIP = new Set([
  'google.com', 'youtube.com', 'wikipedia.org', 't.co', 'twitter.com', 'x.com',
  'instagram.com', 'facebook.com', 'linkedin.com', 'techdrip.net', 'github.com',
]);

export const maxDuration = 60;

const KW_STOPWORDS = new Set([
  'AI', 'LLM', 'ML', 'AGI', 'GPT', 'API',
  '人工知能', '機械学習', '深層学習', 'ディープラーニング',
  'モデル', '研究', '技術', 'データ', 'アルゴリズム', 'システム',
  '学習', '最適化', 'ツール', 'フレームワーク', 'ライブラリ',
]);

export async function POST() {
  try {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const allSources = await db.select().from(sources)
      .where(sql`${sources.status} != 'stopped'`);

    if (allSources.length === 0) {
      return Response.json({
        success: true,
        message: '進化対象のソースがありません',
        stats: { promoted: 0, demoted: 0, stopped: 0, newKeywords: 0 },
      });
    }

    // バッチ取得: 14日以内のヒット数・平均重要度（ソース別）
    const [hitCounts, qualityStats, adoptionCounts, lastAdoptions] = await Promise.all([
      db.select({ sourceId: collectedData.sourceId, cnt: count() })
        .from(collectedData)
        .where(gte(collectedData.createdAt, fourteenDaysAgo))
        .groupBy(collectedData.sourceId),
      db.select({
        sourceId: collectedData.sourceId,
        avg: sql<number>`COALESCE(AVG(${collectedData.importanceScore}), 5)`,
        max: sql<number>`COALESCE(MAX(${collectedData.importanceScore}), 5)`,
      })
        .from(collectedData)
        .where(gte(collectedData.createdAt, fourteenDaysAgo))
        .groupBy(collectedData.sourceId),
      db.select({ sourceId: adoptionLogs.sourceId, cnt: count() })
        .from(adoptionLogs)
        .where(and(eq(adoptionLogs.isAdopted, 1), gte(adoptionLogs.createdAt, thirtyDaysAgo)))
        .groupBy(adoptionLogs.sourceId),
      db.select({
        sourceId: adoptionLogs.sourceId,
        lastAt: sql<string>`MAX(${adoptionLogs.createdAt})`,
      })
        .from(adoptionLogs)
        .where(eq(adoptionLogs.isAdopted, 1))
        .groupBy(adoptionLogs.sourceId),
    ]);

    const hitCountMap = new Map(hitCounts.map(h => [h.sourceId, Number(h.cnt)]));
    const avgImportanceMap = new Map(qualityStats.map(a => [a.sourceId, Number(a.avg)]));
    const maxImportanceMap = new Map(qualityStats.map(a => [a.sourceId, Number(a.max)]));
    const adoptionCountMap = new Map(adoptionCounts.map(a => [a.sourceId, Number(a.cnt)]));
    const lastAdoptionMap = new Map(lastAdoptions.map(a => [a.sourceId, a.lastAt]));

    let promoted = 0, demoted = 0, reactivated = 0, stoppedCount = 0;
    const evolveUpdatedAt = new Date().toISOString();
    const buildSourceUpdate = (id: number, score: number, status: string) =>
      db.update(sources).set({ score, status, updatedAt: evolveUpdatedAt }).where(eq(sources.id, id));
    const updateQueries: ReturnType<typeof buildSourceUpdate>[] = [];

    for (const source of allSources) {
      // フィード型(RSS/HN/ArXiv/GitHub/PwC)は常にactive維持・降格対象外（収集の主要供給源のため）
      if (['rss', 'hn', 'arxiv', 'github-trending', 'pwc'].includes(source.type ?? '')) continue;

      const daysSinceCreated = (now.getTime() - new Date(source.createdAt ?? now).getTime()) / 86400000;
      const hitCount14d = hitCountMap.get(source.id) ?? 0;
      const lastAdoptedAt = lastAdoptionMap.get(source.id);
      const daysSinceAdopted = lastAdoptedAt
        ? (now.getTime() - new Date(lastAdoptedAt).getTime()) / 86400000
        : Infinity;

      // 品質ベースのスコア: (平均×0.6 + 最大×0.4) × (1 + 採用回数 × 0.5)
      const avgImportance = avgImportanceMap.get(source.id) ?? 5;
      const maxImportance = maxImportanceMap.get(source.id) ?? avgImportance;
      const adoptionCount = adoptionCountMap.get(source.id) ?? 0;
      const qualityBase = avgImportance * 0.6 + maxImportance * 0.4;
      const newScore = Math.round(qualityBase * (1 + adoptionCount * 0.5) * 10) / 10;

      let newStatus = source.status ?? 'candidate';
      if (source.status === 'candidate') {
        if (hitCount14d >= 3 && lastAdoptedAt) { newStatus = 'active'; promoted++; }
        else if (daysSinceCreated >= 14) { newStatus = 'stopped'; stoppedCount++; }
      } else if (source.status === 'active') {
        if (daysSinceAdopted >= 14) { newStatus = 'low-priority'; demoted++; }
      } else if (source.status === 'low-priority') {
        if (daysSinceAdopted < 14) { newStatus = 'active'; reactivated++;
        } else if (daysSinceAdopted >= 30) { newStatus = 'stopped'; stoppedCount++; }
      }

      // 変化がある行のみ更新キューに追加
      if (newStatus !== source.status || newScore !== (source.score ?? 0)) {
        updateQueries.push(buildSourceUpdate(source.id, newScore, newStatus));
      }
    }

    // 逐次awaitだと300件超でタイムアウトするため、チャンク単位で並列実行
    for (let i = 0; i < updateQueries.length; i += 30) {
      await Promise.all(updateQueries.slice(i, i + 30));
    }

    // ── 新規キーワード候補の発見（品質強化版）────────────────────────
    let newKeywordsCount = 0;
    try {
      const highQualityData = await db.select({
        summary: collectedData.summary,
        title: collectedData.title,
        importanceScore: collectedData.importanceScore,
      })
        .from(collectedData)
        .where(and(
          gte(collectedData.createdAt, fourteenDaysAgo),
          gte(collectedData.importanceScore, 6),
        ))
        .orderBy(desc(collectedData.importanceScore))
        .limit(15);

      if (highQualityData.length > 0) {
        const allSourceValues = await db.select({ value: sources.value }).from(sources);
        const existingLower = new Set(allSourceValues.map(s => s.value.toLowerCase()));

        const contextText = highQualityData
          .map(d => `[重要度:${d.importanceScore}] ${d.title ?? ''}: ${d.summary ?? ''}`)
          .join('\n');
        const allText = highQualityData
          .map(d => `${d.title ?? ''} ${d.summary ?? ''}`)
          .join(' ')
          .toLowerCase();

        const { object } = await withRetry(() => generateObject({
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

        const rawKws: string[] = object.keywords;
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

          const res = await db.insert(sources)
            .values({ type: 'keyword', value: trimmed, status: 'candidate', score: initialScore })
            .onConflictDoNothing();
          if (res.rowsAffected > 0) {
            newKeywordsCount++;
            addedThisRound.add(kwLower);
            existingLower.add(kwLower);
          }
        }
      }
    } catch (e) {
      console.warn('[Evolve] keyword discovery failed (non-critical):', e);
    }

    // ── ドメイン自動発見（重要度8以上の記事から）──────────────────────
    let newDomainsCount = 0;
    try {
      const highQualityUrls = await db.select({ url: collectedData.url })
        .from(collectedData)
        .where(and(
          gte(collectedData.createdAt, fourteenDaysAgo),
          gte(collectedData.importanceScore, 9),
        ))
        .limit(30);

      for (const { url } of highQualityUrls) {
        if (!url) continue;
        try {
          const hostname = new URL(url).hostname.replace(/^www\./, '');
          if (DOMAIN_SKIP.has(hostname)) continue;
          const allSrcCheck = await db.select({ value: sources.value })
            .from(sources).where(eq(sources.value, hostname)).limit(1);
          if (allSrcCheck.length > 0) continue;
          const r = await db.insert(sources)
            .values({ type: 'keyword', value: hostname, status: 'candidate', score: 2 })
            .onConflictDoNothing();
          if (r.rowsAffected > 0) newDomainsCount++;
        } catch { }
      }
    } catch (e) {
      console.warn('[Evolve] ドメイン発見失敗(非クリティカル):', e);
    }

    return Response.json({
      success: true,
      message: `進化完了: ${promoted}件昇格, ${demoted}件降格, ${reactivated}件再活性化, ${stoppedCount}件停止, ${newKeywordsCount}件新規候補追加, ${newDomainsCount}件新規ドメイン追加`,
      stats: { promoted, demoted, reactivated, stopped: stoppedCount, newKeywords: newKeywordsCount, newDomains: newDomainsCount },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Evolve] error:', error);
    return Response.json({ success: false, message: msg }, { status: 500 });
  }
}
