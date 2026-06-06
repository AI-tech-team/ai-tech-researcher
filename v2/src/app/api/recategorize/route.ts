import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import { db } from '@/db';
import { collectedData } from '@/db/schema';
import { eq, isNull, or, inArray } from 'drizzle-orm';
import { withRetry } from '@/lib/llm';
import { isOwner } from '@/lib/owner';
import { checkRateLimit } from '@/lib/ratelimit';

export const maxDuration = 60;

const VALID_CATEGORIES = ['LLM推論', 'エージェント', 'ツール/フレームワーク', 'ハードウェア', 'ビジネス応用', '研究/論文', 'その他'] as const;

const RecatSchema = z.object({
  items: z.array(z.object({
    id: z.number().int(),
    category: z.enum(VALID_CATEGORIES),
  })),
});

export async function POST() {
  if (!(await isOwner())) return Response.json({ success: false, message: 'オーナー権限が必要です' }, { status: 403 });
  if (!(await checkRateLimit('pipeline', 'owner', 5, 60_000))) return Response.json({ success: false, message: 'レート制限に達しました。少し待ってください' }, { status: 429 });
  try {
    // カテゴリが未設定またはその他の記事を対象（最大40件）
    const items = await db.select({ id: collectedData.id, title: collectedData.title, summary: collectedData.summary })
      .from(collectedData)
      .where(or(isNull(collectedData.category), eq(collectedData.category, 'その他')))
      .limit(40);

    if (items.length === 0) {
      return Response.json({ success: true, message: '再分類対象なし', updated: 0 });
    }

    const { object } = await withRetry(() => generateObject({
      model: google('gemini-2.5-flash-lite'),
      schema: RecatSchema,
      prompt: `以下の記事リストを分析し、各記事に最適なカテゴリを割り当ててください。
カテゴリ選択肢: ${VALID_CATEGORIES.join(' / ')}
必ず全${items.length}件分を返してください。

記事リスト:
${items.map(i => `ID:${i.id} タイトル:${i.title ?? ''} 要約:${(i.summary ?? '').slice(0, 200)}`).join('\n')}`,
    }));

    // id→category のマップを作り、有効なものだけ一括更新
    const validIds = new Set(items.map(i => i.id));
    const byCategory = new Map<string, number[]>();
    for (const r of object.items) {
      if (!validIds.has(r.id)) continue;
      if (!byCategory.has(r.category)) byCategory.set(r.category, []);
      byCategory.get(r.category)!.push(r.id);
    }

    let updated = 0;
    const updateQueries = [...byCategory.entries()].map(([category, ids]) => {
      updated += ids.length;
      return db.update(collectedData).set({ category }).where(inArray(collectedData.id, ids));
    });
    await Promise.all(updateQueries);

    return Response.json({ success: true, message: `${updated}件を再分類しました`, updated });
  } catch (error) {
    // エラー詳細はサーバログのみ。クライアントには内部情報(DB/パス/スタック)を出さない。
    console.error('[Recategorize] error:', error);
    return Response.json({ success: false, message: 'サーバー側でエラーが発生しました。時間をおいて再試行してください。' }, { status: 500 });
  }
}
