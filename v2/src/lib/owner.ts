import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';
import { auth } from '@/auth';

// v6: オーナー権限はパスワード解錠で付与する（Googleログインとは独立）。
// 解錠成功時に httpOnly 署名Cookie を発行し、isOwner() がそれを検証する。
// Cookie の中身はパスワードでもそのハッシュでもなく、AUTH_SECRET による定数HMAC（漏れても再利用不可）。
export const OWNER_COOKIE = 'owner_session';

function secret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-insecure-owner-secret';
}

// 解錠Cookieに入れる署名トークン
export function ownerToken(): string {
  return createHmac('sha256', secret()).update('owner-grant-v1').digest('hex');
}

// 長さ非依存・タイミングセーフな文字列比較
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// OWNER_PASSWORD が設定されているか（UIの出し分け用）
export function ownerPasswordConfigured(): boolean {
  return !!process.env.OWNER_PASSWORD;
}

// 入力パスワードの照合。OWNER_PASSWORD 未設定なら常に false（解錠機能は無効）
export function verifyOwnerPassword(pw: unknown): boolean {
  const expected = process.env.OWNER_PASSWORD;
  if (!expected) return false;
  if (typeof pw !== 'string' || pw.length === 0) return false;
  return safeEqual(pw, expected);
}

// 現在のリクエストがオーナーかどうか
export async function isOwner(): Promise<boolean> {
  // 1) 解錠Cookieの署名検証
  try {
    const c = await cookies();
    const tok = c.get(OWNER_COOKIE)?.value;
    if (tok && safeEqual(tok, ownerToken())) return true;
  } catch {
    // route外などで cookies() が使えない場合は次のフォールバックへ
  }
  // 2) フォールバック: OWNER_PASSWORD 未設定時は、ログイン中の user_id===1 をオーナー扱い（設定ゼロで動く）
  if (!process.env.OWNER_PASSWORD) {
    try {
      const session = await auth();
      if ((session?.user as { id?: number } | undefined)?.id === 1) return true;
    } catch {}
  }
  return false;
}
