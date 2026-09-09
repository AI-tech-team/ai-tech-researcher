import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@libsql/client/web';

// 旧OG用URL（/?article=N・/?report=N）を独立URL（/articles/N・/reports/N）へ寄せる。
// 目的は2つ:
//   ① 記事/レポートは 2026-06-06 に独立URL＋Intercepting Routes へ統一済みで、ここは後方互換の残骸。
//   ② トップの page.tsx が searchParams を読まなくて済む＝静的レンダリング(ISR)が成立し、
//      CDNから配れるようになる（動的化すると no-store になり全アクセスがコールドスタートを踏む）。
// リダイレクトは 302（一時）にしてある。301はブラウザに焼き付いて取り消せないため、
// 本番で挙動を確認してから昇格させる余地を残す（可逆性を優先）。
//
// あわせて「ソフト404」（存在しない記事/レポートIDが HTTP 200 を返す）をここで解消する。
// 2026-09-10 の本番実測: `/articles/999999999` は 200 + not-found UI + `<meta name="robots" content="noindex">`。
// これは Next.js の**仕様どおり**で、`loading.tsx` により本文のストリーミングが始まった後に
// `notFound()` が投げられるため、送信済みのレスポンスヘッダを 404 に変えられない
// （node_modules/next/dist/docs 内 loading.md「Status Codes」）。noindex が入るので検索インデックスへの
// 実害は無いが、ステータスコードとしては誤りなのでドキュメントが示す唯一の方法＝
// 「ストリーミングが始まる前に存在確認する」をこの層で行う。

const ID_PATH_RE = /^\/(articles|reports)\/([^/]+)$/;
const TOPIC_PATH_RE = /^\/topic\/([^/]+)$/;

// 存在が確認できたキーのメモリキャッシュ。インスタンスが再利用される限りDBを再度叩かない。
// 正の結果だけを覚える（削除された記事を「ある」と言い続けないよう、負の結果はキャッシュしない）。
const KNOWN = { articles: new Set<string>(), reports: new Set<string>(), topic: new Set<string>() };
const KNOWN_MAX = 2000; // 際限なく太らせない

let _client: ReturnType<typeof createClient> | null = null;
function getClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return null;
  if (!_client) _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return _client;
}

/** 存在すれば true。判定できない（DB未設定・エラー）場合は true を返して通す＝fail-open。 */
async function exists(kind: 'articles' | 'reports' | 'topic', value: string): Promise<boolean> {
  const cache = KNOWN[kind];
  if (cache.has(value)) return true;
  const c = getClient();
  if (!c) return true;
  try {
    // SQLは必ずプレースホルダ。テーブル名は下のリテラル対応表からしか来ない（文字列連結を作らない）。
    const q = kind === 'articles'
      ? { sql: 'SELECT 1 FROM collected_data WHERE id = ? LIMIT 1', args: [Number(value)] }
      : kind === 'reports'
        ? { sql: 'SELECT 1 FROM reports WHERE id = ? LIMIT 1', args: [Number(value)] }
        : { sql: 'SELECT 1 FROM entities WHERE LOWER(canonical_name) = ? LIMIT 1', args: [value] };
    const res = await c.execute(q);
    const ok = res.rows.length > 0;
    if (ok) {
      if (cache.size >= KNOWN_MAX) cache.clear();
      cache.add(value);
    }
    return ok;
  } catch {
    // 一時的なDB障害で全記事を404にしてしまうのは退化。表示側の fail-open と同じ方針で通す。
    return true;
  }
}

/** 実在しないリソースを、ストリーミング前に404として確定させる */
function toNotFound(req: NextRequest) {
  // ドキュメントが示す「missing slug を not-found ルートへ rewrite する」形。
  // ルートに存在しないパスへ書き換えると、Next のルーティング層が
  // **ストリーミング前に** 404 を確定し、app/not-found.tsx を描く
  // （本番実測: 未定義パス `/nonexistent-page` は 404 を返している）。
  const url = req.nextUrl.clone();
  url.pathname = '/404-not-found';
  url.search = '';
  return NextResponse.rewrite(url);
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // ── ① 記事/レポートの存在確認（ソフト404の解消）──
  const m = ID_PATH_RE.exec(path);
  if (m) {
    const kind = m[1] as 'articles' | 'reports';
    const raw = decodeURIComponent(m[2]);
    // フロントは信用しない: 数値以外・桁あふれ・ゼロ埋めはDBを引くまでもなく404。
    if (!/^[1-9][0-9]{0,9}$/.test(raw)) {
      return new NextResponse(null, { status: 404 });
    }
    if (!(await exists(kind, raw))) return toNotFound(req);
    return NextResponse.next();
  }

  // ── ①' トピックの存在確認（/topic/{未知の名前} も 200 を返していた）──
  const tm = TOPIC_PATH_RE.exec(path);
  if (tm) {
    let name: string;
    try { name = decodeURIComponent(tm[1]); } catch { return toNotFound(req); }
    name = name.trim().toLowerCase();
    // 長すぎる名前はエンティティとして存在しえない（DBを引くまでもない）
    if (!name || name.length > 80) return toNotFound(req);
    if (!(await exists('topic', name))) return toNotFound(req);
    return NextResponse.next();
  }

  // ── ② 旧OG用クエリURLの寄せ（トップのみ）──
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

// トップのクエリ（後方互換）と、記事/レポートの個別ページ（存在確認）だけを対象にする。
export const config = { matcher: ['/', '/articles/:id', '/reports/:id', '/topic/:name'] };
