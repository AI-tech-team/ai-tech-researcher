import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { collectedData, reports } from '@/db/schema';
import { desc, gte } from 'drizzle-orm';

export const maxDuration = 60;

export async function POST() {
  try {
    // 直近7日間の重要度TOP15を取得
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentData = await db.select().from(collectedData)
      .where(gte(collectedData.createdAt, sevenDaysAgo))
      .orderBy(desc(collectedData.importanceScore), desc(collectedData.createdAt))
      .limit(15);

    if (recentData.length === 0) {
      return Response.json({ success: false, message: 'レポートの元になる収集データがありません。' }, { status: 400 });
    }

    const contextStr = recentData
      .map(d => `[重要度:${d.importanceScore ?? 5}/10][${d.category ?? '未分類'}] ${d.title}\n${d.summary}\nURL: ${d.url}\n公開日: ${d.publishedAt?.split('T')[0] ?? '不明'}`)
      .join('\n\n---\n\n');

    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });

    const { text } = await generateText({
      model: google('gemini-2.5-flash-lite'),
      system: `あなたはAI技術動向の専門アナリストです。収集データを元に、AIエンジニア・研究者向けのデイリーレポートをMarkdown形式で作成してください。

【必須構成】
## 🔥 今日のハイライト
重要度8以上の記事を中心に3〜5点。各項目は「何が起きたか」「なぜ重要か」「実務への影響」を2〜3行で。

## 📊 カテゴリ別トピック
カテゴリ（LLM推論/エージェント/ツール・フレームワーク/ハードウェア/ビジネス応用/研究・論文）ごとに整理。

## 💡 エンジニアへの実践的インサイト
今日のデータから導き出せる実装・採用・評価のポイントを箇条書きで。

## 📈 今週の注目トレンド
複数記事を横断して見えるテーマ・トレンドを1〜2段落で。

【ルール】
- 全体1500〜2000文字
- 具体的な数値・ベンチマーク・実装詳細を含める
- 主観的な「すごい」ではなく客観的な事実ベースで記述
- 重要度が高い記事ほど詳しく解説する
- 絵文字・箇条書きを活用して読みやすく`,
      prompt: `今日の日付: ${today}\n\n【収集データ（重要度順・${recentData.length}件）】\n${contextStr}`,
    });

    const reportDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

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
