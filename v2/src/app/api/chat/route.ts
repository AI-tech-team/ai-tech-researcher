import { google } from '@ai-sdk/google';
import { streamText, convertToModelMessages } from 'ai';
import { db } from '@/db';
import { collectedData } from '@/db/schema';
import { desc } from 'drizzle-orm';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const modelMessages = await convertToModelMessages(messages);

  const recentData = await db
    .select({ title: collectedData.title, summary: collectedData.summary, category: collectedData.category })
    .from(collectedData)
    .orderBy(desc(collectedData.createdAt))
    .limit(20);

  const context = recentData
    .map(d => `[${d.category ?? '未分類'}] ${d.title}: ${d.summary}`)
    .join('\n');

  const result = streamText({
    model: google('gemini-2.5-flash-lite'),
    messages: modelMessages,
    system: `あなたは"Research Copilot"、AI Tech Researcherダッシュボードのアシスタントです。
以下は最近収集した最新AI技術情報です：

${context}

これらの情報をもとに、ユーザーの質問に日本語で答えてください。情報がない場合は、一般的な知識で補完してください。`,
  });

  return result.toUIMessageStreamResponse();
}
