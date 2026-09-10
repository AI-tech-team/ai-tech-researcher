// メールのワンクリック配信停止用の署名付きリンク。
//
// なぜ必要か（2026-09-10 監査）: 従来はフッターに「サイトにログインしてプロフィールから」と
// 書いてあるだけで、配信停止URLが無かった。これは特定電子メール法4条の表示義務を満たさず、
// Gmail の一括送信者要件（RFC8058 のワンクリック解除）も満たさないため、
// 有料配信にした瞬間に到達率が構造的に落ちる。
//
// 署名はDBに保存しない: AUTH_SECRET から userId ごとに導出するので、テーブルも失効管理も要らない。
// AUTH_SECRET をローテートすると過去メールのリンクが無効になるが、それは望ましい挙動。
import { createHmac, timingSafeEqual } from 'node:crypto';

function secret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

/** userId から配信停止の署名を作る（32桁の16進）。 */
export function makeUnsubSig(userId: string): string {
  return createHmac('sha256', secret()).update(`unsub:${userId}`).digest('hex').slice(0, 32);
}

/** 署名を検証する。長さ違い・不一致・未設定はすべて false（例外を外に出さない）。 */
export function verifyUnsubSig(userId: string, sig: string): boolean {
  if (!userId || !sig || sig.length !== 32) return false;
  try {
    const a = Buffer.from(makeUnsubSig(userId), 'utf8');
    const b = Buffer.from(sig, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** メールに載せる配信停止URL。 */
export function unsubscribeUrl(siteUrl: string, userId: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  return `${base}/api/unsubscribe?u=${encodeURIComponent(userId)}&s=${makeUnsubSig(userId)}`;
}
