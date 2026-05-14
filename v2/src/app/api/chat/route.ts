import { google } from '@ai-sdk/google';
import { streamText, convertToModelMessages } from 'ai';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();

  // UIMessages → ModelMessages に変換
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: google('gemini-3.1-flash-lite'),
    messages: modelMessages,
    system: `You are the "Research Copilot", an AI assistant for the AI Tech Researcher dashboard.
Your job is to answer questions about the latest AI trends.
Respond in Japanese.
`,
  });

  return result.toUIMessageStreamResponse();
}
