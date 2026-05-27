import { auth } from '@/auth';

// オーナー権限は Google アカウントのメールで判定する。
// 環境変数 OWNER_EMAIL の許可リスト（カンマ区切り可）に、ログイン中のメールが一致すればオーナー。
// 例: OWNER_EMAIL="owner@example.com" / OWNER_EMAIL="a@x.com,b@y.com"
// パスワード解錠・署名Cookie方式は廃止（本人のGoogleアカウントに紐づけ、共有パスワードを持たない）。
function ownerEmails(): string[] {
  return (process.env.OWNER_EMAIL ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// OWNER_EMAIL が設定されているか（UI表示の出し分け用）
export function ownerConfigured(): boolean {
  return ownerEmails().length > 0;
}

// 現在のリクエストがオーナーかどうか
export async function isOwner(): Promise<boolean> {
  try {
    const session = await auth();
    const email = ((session?.user as { email?: string } | undefined)?.email ?? '').trim().toLowerCase();
    if (!email) return false;
    const allow = ownerEmails();
    return allow.length > 0 && allow.includes(email);
  } catch {
    return false;
  }
}
