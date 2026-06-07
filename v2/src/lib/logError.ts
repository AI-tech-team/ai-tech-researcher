// ランタイムエラーの集約ログ＋（設定があれば）オーナーへの通知。第六条「異常検知」の最小実装。
// - 常にサーバログ(console.error)に出す。
// - opts.alert=true かつ メール設定がある場合のみ、同一context 30分に1通までオーナーへ通知（スパム防止）。
// - 通知の失敗・未設定は握りつぶす（本処理を絶対に妨げない＝非致命）。
// - メールに機密を盛らない（先頭6行のスタックのみ。エラーログにフルダンプを残さない＝第一条）。
import * as nodemailer from 'nodemailer';
import { maskPII } from './pii';

const lastAlertAt = new Map<string, number>();
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

export async function logError(context: string, error: unknown, opts?: { alert?: boolean }): Promise<void> {
  console.error(`[${context}]`, error);
  if (!opts?.alert) return;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.REPORT_TO || user;
  if (!user || !pass || !to) return; // 通知先未設定なら静かにスキップ

  const now = Date.now();
  if (now - (lastAlertAt.get(context) ?? 0) < ALERT_COOLDOWN_MS) return; // スロットリング
  lastAlertAt.set(context, now);

  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    // 外部(受信箱)へ出る内容なので、紛れ込んだ明白なPIIは伏せる（多層防御）。
    const msg = maskPII(error instanceof Error ? error.message : String(error));
    const stack = maskPII(error instanceof Error ? (error.stack ?? '').split('\n').slice(0, 6).join('\n') : '');
    await transporter.sendMail({
      from: user,
      to,
      subject: `⚠️ AI Tech Researcher ランタイムエラー: ${context}`,
      text: `箇所: ${context}\nエラー: ${msg}\n\nスタック(先頭6行):\n${stack}`,
    });
  } catch {
    /* 通知自体の失敗は無視（本処理を妨げない） */
  }
}
