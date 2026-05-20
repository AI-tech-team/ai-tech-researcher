import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { collectedData, reports } from '@/db/schema';
import { desc, gte, and, lt, count } from 'drizzle-orm';

export const maxDuration = 60;

export async function POST() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [recentData, thisWeekCounts, lastWeekCounts] = await Promise.all([
      db.select().from(collectedData)
        .where(gte(collectedData.createdAt, sevenDaysAgo))
        .orderBy(desc(collectedData.importanceScore), desc(collectedData.createdAt))
        .limit(15),
      db.select({ category: collectedData.category, cnt: count() })
        .from(collectedData)
        .where(gte(collectedData.createdAt, sevenDaysAgo))
        .groupBy(collectedData.category),
      db.select({ category: collectedData.category, cnt: count() })
        .from(collectedData)
        .where(and(
          gte(collectedData.createdAt, fourteenDaysAgo),
          lt(collectedData.createdAt, sevenDaysAgo),
        ))
        .groupBy(collectedData.category),
    ]);

    if (recentData.length === 0) {
      return Response.json({ success: false, message: 'レポートの元になる収集データがありません。' }, { status: 400 });
    }

    const contextStr = recentData
      .map(d => `[重要度:${d.importanceScore ?? 5}/10][${d.category ?? '未分類'}] ${d.title}\n${d.summary}\nURL: ${d.url}\n公開日: ${d.publishedAt?.split('T')[0] ?? '不明'}`)
      .join('\n\n---\n\n');

    // トレンド計算
    const lastWeekMap = new Map(lastWeekCounts.map(r => [r.category, Number(r.cnt)]));
    const trendLines = thisWeekCounts
      .map(r => ({
        cat: r.category ?? 'その他',
        now: Number(r.cnt),
        prev: lastWeekMap.get(r.category ?? '') ?? 0,
      }))
      .filter(r => r.now >= 2)
      .map(r => ({ ...r, ratio: r.prev === 0 ? r.now * 2 : r.now / r.prev }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 5)
      .map(r => `${r.cat}: 今週${r.now}件/先週${r.prev}件${r.ratio >= 2 ? ' 🚀急上昇' : r.ratio >= 1.3 ? ' ↑上昇' : r.ratio <= 0.7 ? ' ↓減少' : ''}`);

    const trendText = trendLines.length > 0
      ? '\n\n【カテゴリ別週次トレンド（参考データ）】\n' + trendLines.join('\n')
      : '';

    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });

    const { text } = await generateText({
      model: google('gemini-2.5-flash-lite'),
      system: `あなたはAI技術動向の専門アナリストです。収集データを元に、AIエンジニア・研究者向けのデイリーレポートをMarkdown形式で作成してください。

【必須構成】
## 🔥 今日のハイライト
重要度8以上の記事を中心に3〜5点。各項目は「何が起きたか」「なぜ重要か」「実務への影響」を2〜3行で。

## 🚀 急上昇トレンド
トレンドデータを参考に、今週急増しているカテゴリ・トピックを1段落で解説。増加の技術的背景と今後の展望を含めること。データがない場合は今週特に目立つテーマを記述。

## 📊 カテゴリ別トピック
カテゴリ（LLM推論/エージェント/ツール/フレームワーク/ハードウェア/ビジネス応用/研究・論文）ごとに整理。

## 💡 エンジニアへの実践的インサイト
今日のデータから導き出せる実装・採用・評価のポイントを箇条書きで。

【ルール】
- 全体1500〜2000文字
- 具体的な数値・ベンチマーク・実装詳細を含める
- 主観的な「すごい」ではなく客観的な事実ベースで記述
- 重要度が高い記事ほど詳しく解説する
- 絵文字・箇条書きを活用して読みやすく`,
      prompt: `今日の日付: ${today}${trendText}\n\n【収集データ（重要度順・${recentData.length}件）】\n${contextStr}`,
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
