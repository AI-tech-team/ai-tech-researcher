import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { sources, collectedData, adoptionLogs } from '@/db/schema';
import { eq, sql, desc } from 'drizzle-orm';

export const maxDuration = 60;

export async function POST() {
  try {
    const allSources = await db.select().from(sources)
      .where(sql`${sources.status} != 'stopped'`);

    let promoted = 0, demoted = 0, stoppedCount = 0;

    for (const source of allSources) {
      const logs = await db.select().from(adoptionLogs)
        .where(eq(adoptionLogs.sourceId, source.id));

      const adopted = logs.filter(l => l.isAdopted === 1).length;
      const notAdopted = logs.filter(l => l.isAdopted === 0).length;
      const scoreDelta = logs.length === 0 ? -1 : adopted * 10 - notAdopted * 2;
      const newScore = (source.score ?? 0) + scoreDelta;

      let newStatus = source.status;
      if (source.status === 'candidate' && newScore >= 30) { newStatus = 'active'; promoted++; }
      else if (source.status === 'active' && newScore < 0) { newStatus = 'low-priority'; demoted++; }
      else if (source.status === 'low-priority' && newScore < -20) { newStatus = 'stopped'; stoppedCount++; }

      await db.update(sources)
        .set({ score: newScore, status: newStatus, updatedAt: new Date().toISOString() })
        .where(eq(sources.id, source.id));
    }

    // 最新収集データから新規キーワード候補を発見
    const recentData = await db.select({ summary: collectedData.summary })
      .from(collectedData)
      .orderBy(desc(collectedData.createdAt))
      .limit(20);

    let newKeywordsCount = 0;
    if (recentData.length > 0) {
      const { text } = await generateText({
        model: google('gemini-3.1-flash-lite'),
        prompt: `以下の記事サマリー群から、新興AIキーワードを5つ抽出してJSON配列のみで出力してください: ["kw1", "kw2", ...]

${recentData.map(d => d.summary).join('\n')}`,
      });

      try {
        const kws: string[] = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
        for (const kw of kws) {
          const res = await db.insert(sources)
            .values({ type: 'keyword', value: kw.trim(), status: 'candidate', score: 0 })
            .onConflictDoNothing();
          if (res.rowsAffected > 0) newKeywordsCount++;
        }
      } catch { /* キーワード抽出失敗は無視 */ }
    }

    return Response.json({
      success: true,
      message: `進化完了: ${promoted}件昇格, ${demoted}件降格, ${stoppedCount}件停止, ${newKeywordsCount}件新規候補追加`,
      stats: { promoted, demoted, stopped: stoppedCount, newKeywords: newKeywordsCount },
    });
  } catch (error: any) {
    console.error("Evolve error:", error);
    return Response.json({ success: false, message: error.message }, { status: 500 });
  }
}
