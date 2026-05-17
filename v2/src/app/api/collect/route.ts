import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { sources, collectedData } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';

export const maxDuration = 60;

export async function POST() {
  try {
    const sourceList = await db.select().from(sources)
      .where(eq(sources.status, 'active'))
      .orderBy(sql`RANDOM()`)
      .limit(1);

    if (sourceList.length === 0) {
      return Response.json({ success: false, message: 'アクティブなシードがありません。' }, { status: 400 });
    }

    const targetSource = sourceList[0];

    // Gemini + Google Search ツールで実際のWeb検索
    const result = await generateText({
      model: google('gemini-2.5-flash-lite'),
      tools: { google_search: google.tools.googleSearch({}) },
      system: `あなたはAI技術情報収集エンジンです。
与えられたキーワードでGoogle検索を行い、最新のAI技術に関する実際の記事を1つ見つけてください。
以下のJSONフォーマットのみを出力してください：
{"title": "記事タイトル", "url": "実際の記事URL", "summary": "200文字程度の専門的な要約", "category": "LLM推論|エージェント|ツール/フレームワーク|ハードウェア|ビジネス応用|研究/論文|その他 のいずれか1つ", "importance": 8}
importanceは1(低)〜10(高)でAI技術的重要度・新規性を評価してください。`,
      prompt: `対象キーワード: ${targetSource.value}`,
    });

    let parsedData;
    try {
      const jsonStr = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedData = JSON.parse(jsonStr);
    } catch {
      return Response.json({ success: false, message: 'AIからの応答の解析に失敗しました。' }, { status: 500 });
    }

    // タイトル重複チェック
    if (parsedData.title) {
      const existing = await db.select({ id: collectedData.id })
        .from(collectedData)
        .where(eq(collectedData.title, parsedData.title))
        .limit(1);
      if (existing.length > 0) {
        return Response.json({ success: false, message: '同じタイトルの記事が既に存在します。' }, { status: 409 });
      }
    }

    await db.insert(collectedData).values({
      sourceId: targetSource.id,
      title: parsedData.title,
      url: parsedData.url,
      summary: parsedData.summary,
      category: parsedData.category ?? null,
      importanceScore: parsedData.importance ?? 5,
      rawContent: result.text,
      publishedAt: new Date().toISOString(),
    }).onConflictDoNothing();

    await db.update(sources)
      .set({ lastHitAt: new Date().toISOString() })
      .where(eq(sources.id, targetSource.id));

    return Response.json({ success: true, message: 'データの収集に成功しました。', data: parsedData });
  } catch (error: any) {
    console.error("Collection error:", error);
    return Response.json({ success: false, message: error.message }, { status: 500 });
  }
}
