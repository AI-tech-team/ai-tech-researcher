import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import * as nodemailer from 'nodemailer';
import { db } from '@/db';
import { collectedData, reports, claims, benchmarks, adoptionLogs } from '@/db/schema';
import { desc, gte, and, lt, eq, count } from 'drizzle-orm';
import { withRetry } from '@/lib/llm';
import { isOwner } from '@/lib/owner';
import { checkRateLimit } from '@/lib/ratelimit';

export const maxDuration = 60;

const sqlTs = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

// 外部cron用：Authorization: Bearer ${CRON_SECRET} を許可（GitHub Actions遅延を避けJST 06:00 ピッタリ駆動）
function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  return auth === `Bearer ${secret}`;
}

// markdown → 簡易HTML（daily_pipeline.ts の markdownToHtml と同等）
function markdownToHtml(md: string): string {
  let html = md
    .replace(/^## (.+)$/gm, '<h2 style="color:#38bdf8;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:8px;margin-top:28px;margin-bottom:12px">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="color:#818cf8;margin-top:16px;margin-bottom:8px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-family:monospace;font-size:0.9em">$1</code>')
    .replace(/^- (.+)$/gm, '<li style="margin:5px 0;line-height:1.6">$1</li>')
    .replace(/\n\n+/g, '\n\n');
  html = html.replace(/(<li[^>]*>[\s\S]*?<\/li>\n?)+/g, m => `<ul style="padding-left:20px;margin:8px 0">${m}</ul>`);
  html = html.replace(/\n\n/g, '</p><p style="margin:10px 0;line-height:1.7">');
  html = html.replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#0f172a;color:#e2e8f0">
<p style="margin:10px 0;line-height:1.7">${html}</p>
</body></html>`;
}

async function sendEmail(content: string, type = 'デイリー'): Promise<void> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return;
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await transporter.sendMail({
    from: user, to: process.env.REPORT_TO || user, // 受信先を分離可能に（未設定なら従来通り自己送信）
    subject: `🤖 AI Tech Researcher ${type}レポート ${today}`,
    text: content,
    html: markdownToHtml(content),
  });
}

export async function POST(req: Request) {
  const cronAuthed = isCronAuthorized(req);
  if (!cronAuthed && !(await isOwner())) return Response.json({ success: false, message: 'オーナー権限が必要です' }, { status: 403 });
  // 外部cron経由はレート制限スキップ（オーナー手動UIのみ制限）
  if (!cronAuthed && !(await checkRateLimit('pipeline', 'owner', 5, 60_000))) return Response.json({ success: false, message: 'レート制限に達しました。少し待ってください' }, { status: 429 });
  try {
    const sevenDaysAgo = sqlTs(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const fourteenDaysAgo = sqlTs(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));

    const [rawRecent, thisWeekCounts, lastWeekCounts, recentClaims, recentBench] = await Promise.all([
      db.select().from(collectedData)
        .where(gte(collectedData.createdAt, sevenDaysAgo))
        .orderBy(desc(collectedData.importanceScore), desc(collectedData.createdAt))
        .limit(40),
      db.select({ category: collectedData.category, cnt: count() })
        .from(collectedData).where(gte(collectedData.createdAt, sevenDaysAgo)).groupBy(collectedData.category),
      db.select({ category: collectedData.category, cnt: count() })
        .from(collectedData)
        .where(and(gte(collectedData.createdAt, fourteenDaysAgo), lt(collectedData.createdAt, sevenDaysAgo)))
        .groupBy(collectedData.category),
      db.select({ subject: claims.subject, predicate: claims.predicate, value: claims.value })
        .from(claims)
        .where(and(eq(claims.status, 'active'), gte(claims.createdAt, sevenDaysAgo)))
        .orderBy(desc(claims.createdAt)).limit(12),
      db.select({ entityName: benchmarks.entityName, benchmarkName: benchmarks.benchmarkName, score: benchmarks.score, unit: benchmarks.unit })
        .from(benchmarks).where(gte(benchmarks.createdAt, sevenDaysAgo)).orderBy(desc(benchmarks.createdAt)).limit(12),
    ]);

    if (rawRecent.length === 0) {
      return Response.json({ success: false, message: 'レポートの元になる収集データがありません。' }, { status: 400 });
    }

    // 重複ストーリーを代表1件に集約
    const seenStory = new Set<number>();
    const recentData: typeof rawRecent = [];
    for (const d of rawRecent) {
      if (d.storyId != null) { if (seenStory.has(d.storyId)) continue; seenStory.add(d.storyId); }
      recentData.push(d);
      if (recentData.length >= 15) break;
    }

    const contextStr = recentData
      .map(d => {
        const multi = (d.storyCount ?? 1) > 1 ? `（${d.storyCount}媒体が報じた）` : '';
        return `[重要度:${d.importanceScore ?? 5}/10][${d.category ?? '未分類'}]${multi} ${d.titleJa || d.title}\n${d.summary}\nURL: ${d.url}\n公開日: ${d.publishedAt?.split('T')[0] ?? '不明'}`;
      })
      .join('\n\n---\n\n');

    const evidenceLines = [
      ...recentClaims.map(c => `- ${c.subject}: ${c.predicate} = ${c.value}`),
      ...recentBench.map(b => `- ${b.entityName} / ${b.benchmarkName}: ${b.score}${b.unit ?? ''}`),
    ];
    const evidenceText = evidenceLines.length > 0
      ? '\n\n【検証済みの事実・数値（根拠として引用してよい）】\n' + evidenceLines.join('\n')
      : '';

    const lastWeekMap = new Map(lastWeekCounts.map(r => [r.category, Number(r.cnt)]));
    const trendLines = thisWeekCounts
      .map(r => ({ cat: r.category ?? 'その他', now: Number(r.cnt), prev: lastWeekMap.get(r.category ?? '') ?? 0 }))
      .filter(r => r.now >= 2)
      .map(r => ({ ...r, ratio: r.prev === 0 ? r.now * 2 : r.now / r.prev }))
      .sort((a, b) => b.ratio - a.ratio).slice(0, 5)
      .map(r => `${r.cat}: 今週${r.now}件/先週${r.prev}件${r.ratio >= 2 ? ' 🚀急上昇' : r.ratio >= 1.3 ? ' ↑上昇' : r.ratio <= 0.7 ? ' ↓減少' : ''}`);
    const trendText = trendLines.length > 0 ? '\n\n【カテゴリ別週次トレンド（参考データ）】\n' + trendLines.join('\n') : '';

    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });

    const { text } = await withRetry(() => generateText({
      model: google('gemini-2.5-flash'),
      system: `あなたはAI技術動向の専門アナリストです。収集データを元に、AIエンジニア・研究者向けのデイリーレポートをMarkdown形式で作成してください。

【必須構成】
## 🔥 今日のハイライト
重要度8以上の記事を中心に3〜5点。各項目は「何が起きたか」「なぜ重要か」「実務への影響」を2〜3行で。

## 🚀 急上昇トレンド
トレンドデータを参考に、今週急増しているカテゴリ・トピックを1段落で解説。

## 📊 カテゴリ別トピック
カテゴリごとに整理。

## 💡 エンジニアへの実践的インサイト
実装・採用・評価のポイントを箇条書きで。

【ルール】
- 全体1500〜2000文字
- 提示された「検証済みの事実・数値」は積極的に根拠として引用する
- 主観でなく客観的な事実ベースで記述
- 絵文字・箇条書きを活用`,
      prompt: `今日の日付: ${today}${trendText}${evidenceText}\n\n【収集データ（重要度順・${recentData.length}件）】\n${contextStr}`,
    }));

    const reportDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const [inserted] = await db.insert(reports).values({ type: 'daily', content: text, reportDate }).returning();

    // 採用ログ（ソーススコアの根拠）
    const adoptedSourceIds = [...new Set(recentData.map(d => d.sourceId).filter((v): v is number => v != null))];
    if (inserted?.id && adoptedSourceIds.length > 0) {
      await db.insert(adoptionLogs).values(adoptedSourceIds.map(sourceId => ({ reportId: inserted.id, sourceId, isAdopted: 1 as const })));
    }

    // 外部cron駆動時のみメール送信（手動生成では送らない＝既存挙動を維持）
    let emailSent = false;
    if (cronAuthed) {
      try { await sendEmail(text, 'デイリー'); emailSent = true; }
      catch (e) { console.error('[Email] daily report send failed:', e); }
    }

    return Response.json({ success: true, message: 'レポートの生成に成功しました。', data: inserted, emailSent });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Report generation error:', error);
    return Response.json({ success: false, message: msg }, { status: 500 });
  }
}
