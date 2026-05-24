import { google } from '@ai-sdk/google';
import { streamText, convertToModelMessages, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { db } from '@/db';
import { collectedData, readingEvents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { hybridSearch, type RetrievedDoc } from '@/lib/retrieval';

export const maxDuration = 60;

function msgText(m: any): string {
  if (typeof m?.content === 'string') return m.content;
  if (Array.isArray(m?.content)) return m.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('');
  return '';
}

// 検索結果をLLM文脈用のテキストに整形（ID・重要度・何媒体が報道・本文抜粋・URL付き）
function docsToContext(docs: RetrievedDoc[]): string {
  if (docs.length === 0) return '(関連する収集記事は見つかりませんでした)';
  return docs.map(d => {
    const title = d.titleJa || d.title || '(無題)';
    const corrob = d.storyCount > 1 ? `（${d.storyCount}媒体が報道）` : '';
    const body = d.snippet ? `${d.summary ?? ''}\n抜粋: ${d.snippet}` : (d.summary ?? '');
    return `[ID:${d.id}][${d.category ?? '未分類'}|重要度${d.importance}]${corrob} ${title}\n${body}${d.url ? `\nURL: ${d.url}` : ''}`;
  }).join('\n\n---\n\n');
}

export async function POST(req: Request) {
  const { messages } = await req.json();
  const modelMessages = await convertToModelMessages(messages);

  const userTexts = modelMessages.filter((m: any) => m.role === 'user').map(msgText).filter(Boolean);
  const lastText = userTexts[userTexts.length - 1] ?? '';
  // フォロー質問に強くするため直近2発話で検索
  const retrievalQuery = userTexts.slice(-2).join(' ');

  // #deep コマンド: 自前コーパスを根拠にした深掘りリサーチ（外部検索なし）
  if (lastText.startsWith('#deep ')) {
    const theme = lastText.slice(6).trim();
    const docs = await hybridSearch(theme, 15);
    const result = streamText({
      model: google('gemini-2.5-flash-lite'),
      stopWhen: stepCountIs(2),
      system: `あなたはAI Tech Researcherの深掘りリサーチャーです。
**以下の収集済みコーパスの情報のみ**を根拠に、テーマについてエンジニア向けの詳細分析を日本語Markdownで作成してください。
コーパスに無い事実は推測で補わず「収集データには見当たらない」と明記すること。各論点には[ID:数字]で出典を示してください。
構成: ## 概要 / ## 主要な動向 / ## 技術的詳細 / ## 未解決・今後の注目点

【収集コーパス】
${docsToContext(docs)}`,
      prompt: `テーマ「${theme}」について、上記コーパスを根拠に深掘りレポートを作成してください。`,
    });
    return result.toUIMessageStreamResponse();
  }

  // 通常チャット: ハイブリッドRAGで関連記事を文脈注入
  const docs = await hybridSearch(retrievalQuery || lastText, 8);

  const result = streamText({
    model: google('gemini-2.5-flash-lite'),
    messages: modelMessages,
    stopWhen: stepCountIs(3),
    system: `あなたは"Research Copilot"、AI Tech Researcherダッシュボードのアシスタントです。
以下はユーザーの質問に関連して収集データベースを検索した記事です（各記事に[ID:数字]）:

${docsToContext(docs)}

【回答ルール】
- 回答は**上記の収集データに基づいて**ください。出典として[ID:数字]を示すと親切です。
- 上記に該当が無い場合は推測で断定せず「収集データには見当たりません」と述べ、必要に応じて search_articles ツールで再検索してください。
- 必ず日本語で回答してください。
- 「#deep テーマ」でそのテーマの深掘りリサーチ（収集データ根拠）を実行できます。`,
    tools: {
      search_articles: tool({
        description: '収集データベースを意味検索＋全文検索のハイブリッドで検索し、関連記事を返す',
        inputSchema: z.object({
          keywords: z.string().describe('検索したい内容（自然文・キーワードどちらでも可）'),
        }),
        execute: async ({ keywords }) => {
          const found = await hybridSearch(keywords, 6);
          return found.length > 0
            ? found.map(r => `ID:${r.id} [${r.category}] ${r.titleJa || r.title} (重要度:${r.importance})`).join('\n')
            : '該当する記事が見つかりませんでした';
        },
      }),
      fetch_article: tool({
        description: '記事IDを指定して本文(あれば抽出済み全文)を取得し、詳しく読む。深掘り・根拠確認に使う',
        inputSchema: z.object({ articleId: z.number().describe('対象の記事ID') }),
        execute: async ({ articleId }) => {
          const [item] = await db.select({
            title: collectedData.title, titleJa: collectedData.titleJa,
            summary: collectedData.summary, raw: collectedData.rawContent, url: collectedData.url,
          }).from(collectedData).where(eq(collectedData.id, articleId)).limit(1);
          if (!item) return `ID:${articleId} の記事が見つかりません`;
          const body = (item.raw ?? item.summary ?? '(本文なし)').slice(0, 4000);
          return `タイトル: ${item.titleJa || item.title}\nURL: ${item.url ?? ''}\n本文:\n${body}`;
        },
      }),
      toggle_read_later: tool({
        description: '記事IDを指定して「後で読む」リストへの追加・解除を行う',
        inputSchema: z.object({ articleId: z.number().describe('対象の記事ID') }),
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
        inputSchema: z.object({ articleId: z.number().describe('対象の記事ID') }),
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
