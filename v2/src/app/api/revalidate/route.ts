import { revalidatePath } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';

// パイプラインが朝刊を保存した直後に、その号を出すページのキャッシュを捨てさせる。
//
// 経緯: トップは `export const revalidate = 300` の時間切れISR。これは「5分以内に新しくなる」
// という意味ではなく **stale-while-revalidate**（期限切れ後の最初の訪問者には古いページを返し、
// 裏で作り直す）である。1日の訪問が少ないサイトでは、06:00に朝刊が出た後も
// 「最初に来た人だけ前日の号を見せられる」状態が続く。2026-09-11 に実際に発生し、
// レポートid=316は 06:27 に保存・メールも3/3送信済みなのに、トップは9/10の号を出していた。
//
// オンデマンド再検証は時間切れISRと挙動が違い、Route Handlerから呼ぶと
// 「次にそのパスが訪問されたときに再生成」される（node_modules/next/dist/docs の
// revalidatePath.md「Route Handlers」）。stale を返さないので、この穴が塞がる。
//
// ⚠ 再検証するパスは**サーバ側で決め打ちする**。任意パスを受け付けると、
//   秘密が漏れた場合に全ページのキャッシュを連続で捨てさせられる（実質DoS）。
//   外から受け取るのはレポートidだけで、それも数値として検証する。

export const dynamic = 'force-dynamic';

/** 長さの違いも含めて実行時間で漏らさない比較。 */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.REVALIDATE_SECRET;
  // 未設定の環境（プレビュー・ローカル）では機能ごと閉じる。空文字と一致してしまう事故を防ぐ。
  if (!expected) return Response.json({ ok: false }, { status: 503 });

  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !secretMatches(token, expected)) {
    // 理由は返さない（存在するかどうかの手がかりを与えない）。
    return Response.json({ ok: false }, { status: 401 });
  }

  let reportId: number | null = null;
  try {
    const body = (await request.json()) as unknown;
    const raw = (body as { reportId?: unknown } | null)?.reportId;
    if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) reportId = raw;
  } catch {
    // 本文なしでも「トップと紹介ページだけ捨てる」用途で使えるようにする。
  }

  // 朝刊が変わると中身が変わるページだけ。sitemap や記事ページは朝刊とは無関係に更新される。
  const paths = ['/', '/about'];
  if (reportId !== null) paths.push(`/reports/${reportId}`);
  for (const p of paths) revalidatePath(p);

  return Response.json({ ok: true, revalidated: paths });
}
