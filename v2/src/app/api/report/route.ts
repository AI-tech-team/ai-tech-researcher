import { buildDailyReport } from '@/lib/daily-report';
import { isOwner } from '@/lib/owner';
import { checkRateLimit } from '@/lib/ratelimit';
import { logError } from '@/lib/logError';

export const maxDuration = 60;

// オーナー手動の再生成用。定時(06:00 JST)の生成＋メール配信は GitHub Actions の
// PIPELINE_MODE=report（daily_pipeline.ts → 共通の buildDailyReport）が行う。
export async function POST() {
  if (!(await isOwner())) return Response.json({ success: false, message: 'オーナー権限が必要です' }, { status: 403 });
  if (!(await checkRateLimit('pipeline', 'owner', 5, 60_000))) return Response.json({ success: false, message: 'レート制限に達しました。少し待ってください' }, { status: 429 });

  try {
    const result = await buildDailyReport();
    if (!result) return Response.json({ success: false, message: 'レポートの元になる新着データがありません。' }, { status: 400 });
    return Response.json({ success: true, message: 'レポートの生成に成功しました。', data: result.inserted, emailSent: false });
  } catch (error) {
    // エラー詳細はサーバログのみ＋owner通知。クライアントには内部情報(DB/パス/スタック)を出さない。
    await logError('api/report', error, { alert: true });
    return Response.json({ success: false, message: 'サーバー側でエラーが発生しました。時間をおいて再試行してください。' }, { status: 500 });
  }
}
