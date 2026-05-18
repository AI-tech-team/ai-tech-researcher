import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { collectedData } from '@/db/schema';
import { eq, isNull, or } from 'drizzle-orm';

export const maxDuration = 60;

const VALID_CATEGORIES = ['LLM推論', 'エージェント', 'ツール/フレームワーク', 'ハードウェア', 'ビジネス応用', '研究/論文', 'その他'];

export async function POST() {
  try {
    // カテゴリが未設定またはその他の記事を対象（最大50件）
    const items = await db.select({ id: collectedData.id, title: collectedData.title, summary: collectedData.summary })
      .from(collectedData)
      .where(or(isNull(collectedData.category), eq(collectedData.category, 'その他')))
      .limit(50);

    if (items.length === 0) {
      return Response.json({ success: true, message: '再分類対象なし', updated: 0 });
    }

    const prompt = `以下の記事リストを分析し、各記事に最適なカテゴリを割り当ててください。
カテゴリ選択肢: ${VALID_CATEGORIES.join(' / ')}

記事リスト:
${items.map(i => `ID:${i.id} タイトル:${i.title ?? ''} 要約:${i.summary ?? ''}`).join('\n')}

出力形式（JSONのみ）: [{"id": 1, "category": "LLM推論"}, ...]`;

    const { text } = await generateText({
      model: google('gemini-2.5-flash-lite'),
      prompt,
    });

    let results: { id: number; category: string }[] = [];
    try {
      results = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch {
      return Response.json({ success: false, message: 'AI応答の解析に失敗しました' }, { status: 500 });
    }

    let updated = 0;
    for (const r of results) {
      if (!r.id || !VALID_CATEGORIES.includes(r.category)) continue;
      await db.update(collectedData).set({ category: r.category }).where(eq(collectedData.id, r.id));
      updated++;
    }

    return Response.json({ success: true, message: `${updated}件を再分類しました`, updated });
  } catch (error: any) {
    console.error('[Recategorize] error:', error);
    return Response.json({ success: false, message: error.message }, { status: 500 });
  }
}
