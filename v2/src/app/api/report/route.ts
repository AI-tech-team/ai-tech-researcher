import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { collectedData, reports } from '@/db/schema';
import { desc, sql } from 'drizzle-orm';

export const maxDuration = 60;

export async function POST() {
  try {
    // 最新の収集データを取得
    const recentData = await db.select().from(collectedData).orderBy(desc(collectedData.createdAt)).limit(10);
    
    if (recentData.length === 0) {
      return Response.json({ success: false, message: 'レポートの元になる収集データがありません。' }, { status: 400 });
    }

    // レポート生成用のプロンプト構築
    const contextStr = recentData.map(d => `[タイトル: ${d.title}]\n要約: ${d.summary}\nURL: ${d.url}`).join('\n\n---\n\n');

    const { text } = await generateText({
      model: google('gemini-2.5-flash-lite'),
      system: `あなたはAIテック情報収集システムのレポーティングエンジンです。
以下の「収集された最新データ」を元に、2026年5月現在の『AIモデル・AI技術の最前線』に特化したデイリーレポート（Markdown形式）を作成してください。
最新のAI技術動向を常に把握したいエンジニア・研究者が、10分読むだけで最新のAIモデル（GPT-5, Claude 4, Llama 4, Gemini 3.1等）の動向や最先端のユースケースを効率よくキャッチアップできるよう、具体的・実用的なトーンで執筆してください。

レポートには以下の要素を含めてください：
1. **今日のAI技術動向サマリー** (技術的進化の要点)
2. **注目モデル・ツールの深掘り解説** (コンテキスト長、推論速度、コスト、ベンチマーク等の具体的な指標)
3. **エンジニアへの実践的インサイト** (実用的なユースケースや実装アプローチ、採用を検討すべきポイント)
文字数は1200文字程度で、Markdownの箇条書きや絵文字を活用して非常に読みやすく美しくフォーマットしてください。`,
      prompt: `【収集データ】\n${contextStr}`,
    });

    const reportDate = new Date().toISOString().split('T')[0];

    // DBに保存
    const [inserted] = await db.insert(reports).values({
      type: 'daily',
      content: text,
      reportDate: reportDate,
    }).returning();

    return Response.json({ success: true, message: 'レポートの生成に成功しました。', data: inserted });
  } catch (error: any) {
    console.error("Report generation error:", error);
    return Response.json({ success: false, message: error.message }, { status: 500 });
  }
}
