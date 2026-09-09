import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 旧OG用URL（/?article=N・/?report=N）を独立URL（/articles/N・/reports/N）へ寄せる。
// 目的は2つ:
//   ① 記事/レポートは 2026-06-06 に独立URL＋Intercepting Routes へ統一済みで、ここは後方互換の残骸。
//   ② トップの page.tsx が searchParams を読まなくて済む＝静的レンダリング(ISR)が成立し、
//      CDNから配れるようになる（動的化すると no-store になり全アクセスがコールドスタートを踏む）。
// リダイレクトは 302（一時）にしてある。301はブラウザに焼き付いて取り消せないため、
// 本番で挙動を確認してから昇格させる余地を残す（可逆性を優先）。
export function middleware(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const hasArticle = sp.has('article');
  const hasReport = sp.has('report');
  if (!hasArticle && !hasReport) return NextResponse.next();

  // フロントは信用しない: 桁数を含めて数値のみ許可し、それ以外はトップへ落とす。
  const raw = (hasArticle ? sp.get('article') : sp.get('report')) ?? '';
  const valid = /^[0-9]{1,10}$/.test(raw);

  const url = req.nextUrl.clone();
  url.search = '';
  url.pathname = valid ? (hasArticle ? `/articles/${raw}` : `/reports/${raw}`) : '/';
  return NextResponse.redirect(url, 302);
}

// トップのクエリだけを対象にする（他ルートには一切干渉しない）。
export const config = { matcher: '/' };
