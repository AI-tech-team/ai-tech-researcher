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

    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Gemini + Google Search ツールで実際のWeb検索
    const result = await generateText({
      model: google('gemini-2.5-flash-lite'),
      tools: { google_search: google.tools.googleSearch({}) },
      system: `あなたはAI技術情報収集エンジンです。
与えられたキーワードでGoogle検索を行い、過去7日以内（${sevenDaysAgo}〜${today}）に公開・更新されたAI技術に関する実際の記事を1つ見つけてください。
古い記事・既知の情報は除外し、必ず最新の内容を選んでください。
以下のJSONフォーマットのみを出力してください：
{"title": "記事タイトル", "url": "実際の記事URL", "summary": "200文字程度の専門的な要約", "category": "LLM推論|エージェント|ツール/フレームワーク|ハードウェア|ビジネス応用|研究/論文|その他 のいずれか1つ", "importance": 8, "tags": ["タグ1", "タグ2", "タグ3"]}
importanceは1(低)〜10(高)でAI技術的重要度・新規性を評価してください。
tagsは記事内容を表す英語または日本語の短いキーワードを3〜5個選んでください（例: "open-source", "multimodal", "benchmark", "fine-tuning"）。`,
      prompt: `対象キーワード: ${targetSource.value}\n検索対象期間: ${sevenDaysAgo}〜${today}`,
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

    const tagsJson = Array.isArray(parsedData.tags) && parsedData.tags.length > 0
      ? JSON.stringify(parsedData.tags.slice(0, 5).map((t: any) => String(t).trim()))
      : null;

    await db.insert(collectedData).values({
      sourceId: targetSource.id,
      title: parsedData.title,
      url: parsedData.url,
      summary: parsedData.summary,
      category: parsedData.category ?? null,
      importanceScore: parsedData.importance ?? 5,
      tags: tagsJson,
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
