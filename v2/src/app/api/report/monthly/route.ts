import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { collectedData, reports } from '@/db/schema';
import { desc, gte } from 'drizzle-orm';
import { isOwner } from '@/lib/owner';
import { checkRateLimit } from '@/lib/ratelimit';

export const maxDuration = 60;

export async function POST() {
  if (!(await isOwner())) return Response.json({ success: false, message: 'オーナー権限が必要です' }, { status: 403 });
  if (!(await checkRateLimit('pipeline', 'owner', 5, 60_000))) return Response.json({ success: false, message: 'レート制限に達しました。少し待ってください' }, { status: 429 });
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const since = thirtyDaysAgo.toISOString().replace('T', ' ').slice(0, 19);

    const recentData = await db.select().from(collectedData)
      .where(gte(collectedData.createdAt, since))
      .orderBy(desc(collectedData.createdAt))
      .limit(100);

    if (recentData.length === 0) {
      return Response.json({ success: false, message: '過去30日間の収集データがありません。' }, { status: 400 });
    }

    const contextStr = recentData.map(d => `[${d.title}]\n${d.summary}\n${d.url}`).join('\n\n---\n\n');

    const { text } = await generateText({
      model: google('gemini-2.5-flash-lite'),
      system: `あなたはAIテック情報収集システムのレポーティングエンジンです。
過去1ヶ月に収集されたAI技術情報を元に、月次サマリーレポート（Markdown形式）を作成してください。
エンジニア・研究者向けに、今月のAI業界の大きな流れを総括し、技術的に重要な変化・トレンドを体系的に整理してください。

レポートには以下の要素を含めてください：
1. **今月の重大ニュース TOP5** (最も影響の大きかった出来事)
2. **技術トレンド総括** (モデル・インフラ・応用の各レイヤーでの変化)
3. **業界地図の変化** (プレイヤーの動向・勢力図)
4. **来月の展望** (注目イベント・リリース予定・注視すべき動き)
文字数は3000文字程度、Markdownと絵文字で読みやすくフォーマットしてください。`,
      prompt: `【今月の収集データ（${recentData.length}件）】\n${contextStr}`,
    });

    const reportDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    const [inserted] = await db.insert(reports).values({
      type: 'monthly',
      content: text,
      reportDate,
    }).returning();

    return Response.json({ success: true, message: '月次レポートを生成しました。', data: inserted });
  } catch (error) {
    // エラー詳細はサーバログのみ。クライアントには内部情報を出さない。
    console.error("Monthly report error:", error);
    return Response.json({ success: false, message: 'サーバー側でエラーが発生しました。時間をおいて再試行してください。' }, { status: 500 });
  }
}
