import { google } from '@ai-sdk/google';
import { streamText, convertToModelMessages, tool, stepCountIs, embedMany } from 'ai';
import { z } from 'zod';
import { db, client } from '@/db';
import { collectedData, readingEvents, userArticleState, userProfiles } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { hybridSearch, graphContext, cachedQueryEmbed, type RetrievedDoc } from '@/lib/retrieval';
import { auth } from '@/auth';
import { isOwner } from '@/lib/owner';
import { checkRateLimit } from '@/lib/ratelimit';

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

// C 長期記憶: 過去の会話から関連する発話を意味検索して文脈に呼び出す
async function recallMemory(userId: number, query: string): Promise<string> {
  try {
    if (!query.trim()) return '';
    const vec = await cachedQueryEmbed(query.slice(0, 800));
    if (!vec) return '';
    const res = await client.execute({
      sql: `SELECT cm.role AS role, cm.content AS content
            FROM vector_top_k('chat_memory_embedding_idx', vector32(?), 12) AS v
            JOIN chat_memory cm ON cm.rowid = v.id
            WHERE cm.user_id = ? LIMIT 5`,
      args: [JSON.stringify(vec), userId],
    });
    if (res.rows.length === 0) return '';
    return (res.rows as any[])
      .map(r => `- [${r.role === 'user' ? 'あなた' : 'AI'}] ${String(r.content).replace(/\s+/g, ' ').slice(0, 280)}`)
      .join('\n');
  } catch {
    return '';
  }
}

// C 長期記憶: 1往復をユーザー別に保存（埋め込みはバッチ1回・非クリティカル）
async function rememberExchange(userId: number, userText: string, assistantText: string) {
  try {
    const items: { role: string; text: string }[] = [];
    if (userText.trim()) items.push({ role: 'user', text: userText.slice(0, 2000) });
    if (assistantText.trim()) items.push({ role: 'assistant', text: assistantText.slice(0, 2000) });
    if (items.length === 0) return;
    const { embeddings } = await embedMany({
      model: google.embedding('gemini-embedding-001'),
      values: items.map(i => i.text),
      providerOptions: { google: { outputDimensionality: 768, taskType: 'RETRIEVAL_DOCUMENT' } },
    });
    for (let i = 0; i < items.length; i++) {
      await client.execute({
        sql: `INSERT INTO chat_memory (user_id, role, content, embedding) VALUES (?, ?, ?, vector32(?))`,
        args: [userId, items[i].role, items[i].text, JSON.stringify(embeddings[i])],
      });
    }
  } catch (e) {
    console.warn('rememberExchange failed:', e);
  }
}

// 記事IDを解決。articleId優先、無ければtitleOrQueryでハイブリッド検索の最上位を採用。
async function resolveArticleId(articleId?: number, titleOrQuery?: string): Promise<number | null> {
  if (typeof articleId === 'number' && Number.isFinite(articleId)) return articleId;
  if (titleOrQuery && titleOrQuery.trim()) {
    const found = await hybridSearch(titleOrQuery, 1);
    return found[0]?.id ?? null;
  }
  return null;
}

const targetSchema = z.object({
  articleId: z.number().optional().describe('対象の記事ID（分かっている場合）'),
  titleOrQuery: z.string().optional().describe('記事のタイトルや内容（IDが分からない時。ここから自動で記事を特定する）'),
});

export async function POST(req: Request) {
  if (!(await isOwner())) return Response.json({ error: 'オーナー権限が必要です' }, { status: 403 });

  // 不正利用防止: 巨大ボディ拒否＋入力サイズ上限＋レート制限（userId別・IP不使用）
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > 200_000) return Response.json({ error: 'リクエストが大きすぎます' }, { status: 413 });

  const userId = ((await auth())?.user as { id?: number } | undefined)?.id;
  const rlKey = String(userId ?? 'owner');
  if (!(await checkRateLimit('chat_min', rlKey, 20, 60_000)) || !(await checkRateLimit('chat_day', rlKey, 300, 86_400_000))) {
    return Response.json({ error: 'レート制限に達しました。しばらく待ってから再試行してください。' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
    return Response.json({ error: 'メッセージ形式が不正です' }, { status: 400 });
  }
  const totalChars = messages.reduce((n: number, m: any) => n + msgText(m).length, 0);
  if (totalChars > 24_000) return Response.json({ error: '入力が長すぎます' }, { status: 400 });

  const modelMessages = await convertToModelMessages(messages);

  const userTexts = modelMessages.filter((m: any) => m.role === 'user').map(msgText).filter(Boolean);
  const lastText = userTexts[userTexts.length - 1] ?? '';
  const retrievalQuery = userTexts.slice(-2).join(' '); // フォロー質問に強くするため直近2発話

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

  // 通常チャット: ハイブリッドRAG(記事＋パッセージ)＋GraphRAG(知識グラフ)＋長期記憶で文脈注入
  const [docs, graph, prof, memory] = await Promise.all([
    hybridSearch(retrievalQuery || lastText, 8),
    graphContext(retrievalQuery || lastText),
    userId
      ? db.select({ interests: userProfiles.interests, goals: userProfiles.goals })
          .from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1)
          .then(r => r[0] ?? null).catch(() => null)
      : Promise.resolve(null),
    userId ? recallMemory(userId, retrievalQuery || lastText) : Promise.resolve(''),
  ]);
  const graphBlock = graph ? `\n\n## 関連知識（知識グラフ：ベンチマーク/関係/事実）\n${graph}` : '';
  const memoryBlock = memory ? `\n\n## 過去の会話の記憶（このユーザーとの以前のやり取り。文脈の継続に使う）\n${memory}` : '';
  // ユーザーの興味・目標を回答の方向性に反映（追加API呼び出しなし・トークン微増のみ）
  const personaBits: string[] = [];
  if (prof?.interests?.trim()) personaBits.push(`興味: ${prof.interests.trim()}`);
  if (prof?.goals?.trim()) personaBits.push(`いま調べていること/目標: ${prof.goals.trim()}`);
  const personaBlock = personaBits.length
    ? `\n\n## ユーザーのプロフィール（回答の方向性・具体例の選択に反映する）\n${personaBits.join('\n')}`
    : '';

  const result = streamText({
    model: google('gemini-2.5-flash-lite'),
    messages: modelMessages,
    stopWhen: stepCountIs(4),
    onFinish: async ({ text }) => { if (userId) await rememberExchange(userId, lastText, text); },
    system: `あなたは"Research Copilot"、AI Tech Researcherダッシュボードのアシスタントです。
以下はユーザーの質問に関連して収集データベースを検索した記事です（各記事に[ID:数字]）:

${docsToContext(docs)}${graphBlock}${personaBlock}${memoryBlock}

【回答ルール】
- 回答は**上記の収集データに基づいて**ください。出典として[ID:数字]を示すと親切です。
- 上記に該当が無い場合は推測で断定せず「収集データには見当たりません」と述べ、必要に応じて search_articles ツールで再検索してください。
- **お気に入り/後で読むの追加・解除**は、ユーザーがIDを言わなくても実行できます。記事のタイトルや内容を
  toggle_favorite / toggle_read_later の titleOrQuery に渡せば自動で対象記事を特定します。文脈中の記事を指していれば[ID]を使っても構いません。
- 「○○をお気に入りに」「△△を後で読むに」と言われたら、確認を求めず即座にツールを実行してください。
- 必ず日本語で回答してください。「#deep テーマ」で深掘りリサーチ（収集データ根拠）も可能です。`,
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
        description: '記事IDまたはタイトル/内容を指定して本文(あれば抽出済み全文)を取得し、詳しく読む',
        inputSchema: targetSchema,
        execute: async ({ articleId, titleOrQuery }) => {
          const id = await resolveArticleId(articleId, titleOrQuery);
          if (id == null) return '対象の記事を特定できませんでした';
          const [item] = await db.select({
            title: collectedData.title, titleJa: collectedData.titleJa,
            summary: collectedData.summary, raw: collectedData.rawContent, url: collectedData.url,
          }).from(collectedData).where(eq(collectedData.id, id)).limit(1);
          if (!item) return `ID:${id} の記事が見つかりません`;
          const body = (item.raw ?? item.summary ?? '(本文なし)').slice(0, 4000);
          return `ID:${id}\nタイトル: ${item.titleJa || item.title}\nURL: ${item.url ?? ''}\n本文:\n${body}`;
        },
      }),
      toggle_read_later: tool({
        description: '「後で読む」への追加・解除。記事IDが無くてもタイトル/内容(titleOrQuery)から特定できる',
        inputSchema: targetSchema,
        execute: async ({ articleId, titleOrQuery }) => {
          if (!userId) return 'この操作にはログインが必要です';
          const id = await resolveArticleId(articleId, titleOrQuery);
          if (id == null) return '対象の記事を特定できませんでした。タイトルをもう少し具体的に教えてください';
          const [item] = await db.select({ id: collectedData.id, title: collectedData.title, titleJa: collectedData.titleJa, category: collectedData.category })
            .from(collectedData).where(eq(collectedData.id, id)).limit(1);
          if (!item) return `ID:${id} の記事が見つかりません`;
          const [cur] = await db.select({ v: userArticleState.isReadLater }).from(userArticleState)
            .where(and(eq(userArticleState.userId, userId), eq(userArticleState.articleId, id))).limit(1);
          const newVal = cur?.v ? 0 : 1;
          await db.insert(userArticleState).values({ userId, articleId: id, isReadLater: newVal })
            .onConflictDoUpdate({ target: [userArticleState.userId, userArticleState.articleId], set: { isReadLater: newVal, updatedAt: new Date().toISOString() } });
          if (newVal) await db.insert(readingEvents).values({ articleId: id, action: 'readlater', weight: 1, category: item.category, userId });
          return `「${item.titleJa || item.title}」(ID:${id})を${newVal ? '後で読むに追加' : '後で読むから解除'}しました`;
        },
      }),
      toggle_favorite: tool({
        description: 'お気に入りの追加・解除。記事IDが無くてもタイトル/内容(titleOrQuery)から特定できる',
        inputSchema: targetSchema,
        execute: async ({ articleId, titleOrQuery }) => {
          if (!userId) return 'この操作にはログインが必要です';
          const id = await resolveArticleId(articleId, titleOrQuery);
          if (id == null) return '対象の記事を特定できませんでした。タイトルをもう少し具体的に教えてください';
          const [item] = await db.select({ id: collectedData.id, title: collectedData.title, titleJa: collectedData.titleJa, category: collectedData.category })
            .from(collectedData).where(eq(collectedData.id, id)).limit(1);
          if (!item) return `ID:${id} の記事が見つかりません`;
          const [cur] = await db.select({ v: userArticleState.isFavorited }).from(userArticleState)
            .where(and(eq(userArticleState.userId, userId), eq(userArticleState.articleId, id))).limit(1);
          const newVal = cur?.v ? 0 : 1;
          await db.insert(userArticleState).values({ userId, articleId: id, isFavorited: newVal })
            .onConflictDoUpdate({ target: [userArticleState.userId, userArticleState.articleId], set: { isFavorited: newVal, updatedAt: new Date().toISOString() } });
          if (newVal) await db.insert(readingEvents).values({ articleId: id, action: 'favorite', weight: 3, category: item.category, userId });
          return `「${item.titleJa || item.title}」(ID:${id})を${newVal ? 'お気に入りに追加' : 'お気に入りから解除'}しました`;
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
