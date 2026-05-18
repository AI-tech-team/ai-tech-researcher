import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { sources, collectedData, adoptionLogs } from '@/db/schema';
import { eq, sql, desc, inArray } from 'drizzle-orm';

export const maxDuration = 60;

export async function POST() {
  try {
    const allSources = await db.select().from(sources)
      .where(sql`${sources.status} != 'stopped'`);

    if (allSources.length === 0) {
      return Response.json({
        success: true,
        message: '進化対象のソースがありません',
        stats: { promoted: 0, demoted: 0, stopped: 0, newKeywords: 0 },
      });
    }

    // 全adoption_logsを1クエリで取得（N+1 → 1+N に最適化）
    const sourceIds = allSources.map(s => s.id);
    const allLogs = await db.select({
      sourceId: adoptionLogs.sourceId,
      isAdopted: adoptionLogs.isAdopted,
    }).from(adoptionLogs)
      .where(inArray(adoptionLogs.sourceId, sourceIds));

    // sourceIdでグループ化
    const logMap = new Map<number, { adopted: number; notAdopted: number }>();
    for (const log of allLogs) {
      if (log.sourceId == null) continue;
      const entry = logMap.get(log.sourceId) ?? { adopted: 0, notAdopted: 0 };
      if (log.isAdopted === 1) entry.adopted++;
      else entry.notAdopted++;
      logMap.set(log.sourceId, entry);
    }

    let promoted = 0, demoted = 0, stoppedCount = 0;

    for (const source of allSources) {
      const logs = logMap.get(source.id) ?? { adopted: 0, notAdopted: 0 };
      const total = logs.adopted + logs.notAdopted;
      const scoreDelta = total === 0 ? -1 : logs.adopted * 10 - logs.notAdopted * 2;
      const newScore = (source.score ?? 0) + scoreDelta;

      let newStatus = source.status;
      if (source.status === 'candidate' && newScore >= 30) { newStatus = 'active'; promoted++; }
      else if (source.status === 'active' && newScore < 0) { newStatus = 'low-priority'; demoted++; }
      else if (source.status === 'low-priority' && newScore < -20) { newStatus = 'stopped'; stoppedCount++; }

      await db.update(sources)
        .set({ score: newScore, status: newStatus as any, updatedAt: new Date().toISOString() })
        .where(eq(sources.id, source.id));
    }

    // 新規キーワード候補の発見（失敗しても全体は成功扱い）
    let newKeywordsCount = 0;
    try {
      const recentData = await db.select({ summary: collectedData.summary })
        .from(collectedData)
        .orderBy(desc(collectedData.createdAt))
        .limit(20);

      if (recentData.length > 0) {
        const { text } = await generateText({
          model: google('gemini-2.5-flash-lite'),
          prompt: `以下の記事サマリー群から、新興AIキーワードを5つ抽出してJSON配列のみで出力してください: ["kw1", "kw2", ...]

${recentData.map(d => d.summary).join('\n')}`,
        });

        const kws: string[] = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
        for (const kw of kws) {
          const trimmed = kw.trim();
          if (!trimmed || trimmed.length > 100) continue;
          const res = await db.insert(sources)
            .values({ type: 'keyword', value: trimmed, status: 'candidate', score: 0 })
            .onConflictDoNothing();
          if (res.rowsAffected > 0) newKeywordsCount++;
        }
      }
    } catch (e) {
      console.warn('[Evolve] keyword discovery failed (non-critical):', e);
    }

    return Response.json({
      success: true,
      message: `進化完了: ${promoted}件昇格, ${demoted}件降格, ${stoppedCount}件停止, ${newKeywordsCount}件新規候補追加`,
      stats: { promoted, demoted, stopped: stoppedCount, newKeywords: newKeywordsCount },
    });
  } catch (error: any) {
    console.error('[Evolve] error:', error);
    return Response.json({ success: false, message: error.message }, { status: 500 });
  }
}
