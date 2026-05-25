import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { collectedData, reports } from '@/db/schema';
import { desc, gte, eq } from 'drizzle-orm';
import { isOwner } from '@/lib/owner';

export const maxDuration = 60;

export async function POST() {
  if (!(await isOwner())) return Response.json({ success: false, message: 'オーナー権限が必要です' }, { status: 403 });
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const since = sevenDaysAgo.toISOString().replace('T', ' ').slice(0, 19);

    const recentData = await db.select().from(collectedData)
      .where(gte(collectedData.createdAt, since))
      .orderBy(desc(collectedData.createdAt))
      .limit(70);

    if (recentData.length === 0) {
      return Response.json({ success: false, message: '過去7日間の収集データがありません。' }, { status: 400 });
    }

    const contextStr = recentData.map(d => `[${d.title}]\n${d.summary}\n${d.url}`).join('\n\n---\n\n');

    // 前回の週次レポートを取得（変化点比較用）
    const prevWeekly = await db.select().from(reports)
      .where(eq(reports.type, 'weekly'))
      .orderBy(desc(reports.createdAt))
      .limit(1);

    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
    const comparisonSection = prevWeekly[0]
      ? `\n\n---\n\n【前回の週次レポート（変化点分析用）】\n${prevWeekly[0].content?.substring(0, 800)}`
      : '';

    const { text } = await generateText({
      model: google('gemini-2.5-flash-lite'),
      system: `あなたはAIテック情報収集システムのレポーティングエンジンです。
過去1週間に収集されたAI技術情報を元に、週次サマリーレポート（Markdown形式）を作成してください。
エンジニア・研究者向けに、今週のAI業界の重要トピックを整理し、週全体の流れと注目ポイントを俯瞰できる内容にしてください。
前回のレポートがある場合は、今週新たに浮上したトピックや消えたトレンドを明示してください。

レポートには以下の要素を含めてください：
1. **今週の3大トピック** (最重要ニュース3選)
2. **技術トレンドの週間まとめ** (モデル・ツール・手法の動向)
3. **先週からの変化点** (新登場・消えたトレンド・注目度の変化)
4. **来週のウォッチポイント** (注目すべき動きの予測)
文字数は2000文字程度、Markdownと絵文字で読みやすくフォーマットしてください。`,
      prompt: `今日の日付: ${today}\n\n【今週の収集データ（${recentData.length}件）】\n${contextStr}${comparisonSection}`,
    });

    const reportDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    const [inserted] = await db.insert(reports).values({
      type: 'weekly',
      content: text,
      reportDate,
    }).returning();

    return Response.json({ success: true, message: '週次レポートを生成しました。', data: inserted });
  } catch (error: any) {
    console.error("Weekly report error:", error);
    return Response.json({ success: false, message: error.message }, { status: 500 });
  }
}
