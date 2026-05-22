import { google } from '@ai-sdk/google';
import { streamText, convertToModelMessages, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { db } from '@/db';
import { collectedData, readingEvents } from '@/db/schema';
import { desc, eq, like, or } from 'drizzle-orm';

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const modelMessages = await convertToModelMessages(messages);

  // #deep コマンド検出
  const lastMsg = modelMessages[modelMessages.length - 1];
  const lastText = typeof lastMsg?.content === 'string'
    ? lastMsg.content
    : Array.isArray(lastMsg?.content)
      ? lastMsg.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
      : '';

  if (lastText.startsWith('#deep ')) {
    const theme = lastText.slice(6).trim();
    const result = streamText({
      model: google('gemini-2.5-flash-lite'),
      tools: { google_search: google.tools.googleSearch({}) },
      system: `あなたはAI技術の深掘りリサーチャーです。指定されたテーマについて、最新情報を幅広く調査し、
エンジニア向けの詳細な分析レポートを日本語Markdown形式で作成してください。
構成: ## 概要 / ## 主要な動向（5件以上） / ## 技術的詳細 / ## 今後の展望`,
      prompt: `テーマ「${theme}」について深掘りリサーチしてください。最新の技術動向、重要な発表、実装例を含めて2000文字以上の詳細レポートを作成してください。`,
      stopWhen: stepCountIs(3),
    });
    return result.toUIMessageStreamResponse();
  }

  const recentData = await db
    .select({ id: collectedData.id, title: collectedData.title, summary: collectedData.summary, category: collectedData.category })
    .from(collectedData)
    .orderBy(desc(collectedData.createdAt))
    .limit(20);

  const context = recentData
    .map(d => `[ID:${d.id}][${d.category ?? '未分類'}] ${d.title}: ${d.summary}`)
    .join('\n');

  const result = streamText({
    model: google('gemini-2.5-flash-lite'),
    messages: modelMessages,
    stopWhen: stepCountIs(3),
    system: `あなたは"Research Copilot"、AI Tech Researcherダッシュボードのアシスタントです。
以下は最近収集した最新AI技術情報です（各記事には[ID:数字]が付いています）：

${context}

これらの情報をもとに、ユーザーの質問に日本語で答えてください。
ツールを使って記事の検索・お気に入り登録・後で読む登録も行えます。
「#deep テーマ」と送信するとそのテーマの深掘りリサーチを実行します。`,
    tools: {
      search_articles: tool({
        description: 'DBの記事をキーワードで検索して、関連する記事ID・タイトル・要約を返す',
        inputSchema: z.object({
          keywords: z.string().describe('検索キーワード（スペース区切りで複数可）'),
        }),
        execute: async ({ keywords }) => {
          const kws = keywords.split(/\s+/).slice(0, 4);
          const conditions = kws.flatMap(kw => [
            like(collectedData.title, `%${kw}%`),
            like(collectedData.summary, `%${kw}%`),
          ]);
          const rows = await db.select({
            id: collectedData.id,
            title: collectedData.title,
            summary: collectedData.summary,
            category: collectedData.category,
            importanceScore: collectedData.importanceScore,
          })
            .from(collectedData)
            .where(or(...conditions))
            .orderBy(desc(collectedData.importanceScore))
            .limit(5);
          return rows.length > 0
            ? rows.map(r => `ID:${r.id} [${r.category}] ${r.title} (重要度:${r.importanceScore})`).join('\n')
            : '該当する記事が見つかりませんでした';
        },
      }),
      toggle_read_later: tool({
        description: '記事IDを指定して「後で読む」リストへの追加・解除を行う',
        inputSchema: z.object({
          articleId: z.number().describe('対象の記事ID'),
        }),
        execute: async ({ articleId }) => {
          const [item] = await db.select({ id: collectedData.id, isReadLater: collectedData.isReadLater, title: collectedData.title, category: collectedData.category })
            .from(collectedData).where(eq(collectedData.id, articleId)).limit(1);
          if (!item) return `ID:${articleId} の記事が見つかりません`;
          const newVal = item.isReadLater ? 0 : 1;
          await db.update(collectedData).set({ isReadLater: newVal }).where(eq(collectedData.id, articleId));
          if (newVal) await db.insert(readingEvents).values({ articleId, action: 'readlater', weight: 1, category: item.category });
          return `「${item.title}」を${newVal ? '後で読むに追加' : '後で読むから解除'}しました`;
        },
      }),
      toggle_favorite: tool({
        description: '記事IDを指定してお気に入りの追加・解除を行う',
        inputSchema: z.object({
          articleId: z.number().describe('対象の記事ID'),
        }),
        execute: async ({ articleId }) => {
          const [item] = await db.select({ id: collectedData.id, isFavorited: collectedData.isFavorited, title: collectedData.title, category: collectedData.category })
            .from(collectedData).where(eq(collectedData.id, articleId)).limit(1);
          if (!item) return `ID:${articleId} の記事が見つかりません`;
          const newVal = item.isFavorited ? 0 : 1;
          await db.update(collectedData).set({ isFavorited: newVal }).where(eq(collectedData.id, articleId));
          if (newVal) await db.insert(readingEvents).values({ articleId, action: 'favorite', weight: 3, category: item.category });
          return `「${item.title}」を${newVal ? 'お気に入りに追加' : 'お気に入りから解除'}しました`;
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
