// ワンクリック配信停止。特定電子メール法4条の「受信拒否の通知先」と
// RFC8058（Gmail/Yahoo の一括送信者要件）のワンクリック解除を同時に満たす。
//
// ログイン不要（メールの受信者はブラウザにセッションを持っていない）。認可は
// AUTH_SECRET から導出した署名で行い、userId ごとに固定・DB保存なし。
import { db } from '@/db';
import { userProfiles } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { verifyUnsubSig } from '@/lib/unsubscribe-link';
import { checkRateLimit } from '@/lib/ratelimit';
import { logError } from '@/lib/logError';
import { SITE_NAME } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function optOut(u: string, s: string): Promise<'ok' | 'invalid' | 'error'> {
  // 署名は文字列表現に対して作る（メール側も String(uid) で作っている）。DBのキーは整数。
  if (!/^\d{1,15}$/.test(u)) return 'invalid';
  if (!verifyUnsubSig(u, s)) return 'invalid';
  // 署名が正しくても、総当たりや連打でDBを焼かれないように上限を掛ける
  if (!await checkRateLimit('unsub', u, 20, 60_000)) return 'error';
  try {
    await db.update(userProfiles).set({ emailOptIn: 0 }).where(eq(userProfiles.userId, Number(u)));
    return 'ok';
  } catch (e) {
    await logError('unsubscribe', e, { alert: true });
    return 'error';
  }
}

function page(title: string, body: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} — ${SITE_NAME}</title>
<style>body{font-family:system-ui,-apple-system,'Hiragino Sans',sans-serif;margin:0;display:grid;
place-items:center;min-height:100dvh;background:#f4f2ee;color:#16181c;padding:24px}
main{max-width:34rem;text-align:center;line-height:1.9}h1{font-size:1.25rem;margin:0 0 .6rem}
p{margin:0 0 1rem;color:#3b414c;font-size:.95rem}a{color:#1f3a68}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

/** RFC8058: メールクライアントは List-Unsubscribe-Post を付けて POST してくる（確認画面を出さない）。 */
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const r = await optOut(url.searchParams.get('u') ?? '', url.searchParams.get('s') ?? '');
  // ワンクリック解除では本文は読まれない。ステータスだけが意味を持つ。
  return new Response(null, { status: r === 'ok' ? 200 : r === 'invalid' ? 400 : 500 });
}

/** 人がリンクを踏んだ場合。確認画面を挟まず即座に停止し、結果を伝える。 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const r = await optOut(url.searchParams.get('u') ?? '', url.searchParams.get('s') ?? '');
  const site = url.origin;
  if (r === 'ok') {
    return page('配信を停止しました',
      `<p>今後、朝のダイジェストメールは届きません。</p>
       <p>再開したいときは <a href="${site}">${SITE_NAME}</a> にログインし、右上のプロフィールから切り替えられます。</p>`, 200);
  }
  if (r === 'invalid') {
    return page('リンクが無効です',
      `<p>リンクの有効期限が切れているか、URLが途中で切れている可能性があります。</p>
       <p><a href="${site}">${SITE_NAME}</a> にログインし、プロフィールから配信を停止できます。</p>`, 400);
  }
  return page('停止できませんでした',
    `<p>一時的な障害の可能性があります。少し時間をおいて、もう一度お試しください。</p>
     <p><a href="${site}">${SITE_NAME}</a> のプロフィールからも停止できます。</p>`, 500);
}
