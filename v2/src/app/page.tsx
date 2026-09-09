import { getPublicCoreData } from './actions';
import { PublicApp, type PublicInitial } from '@/components/public/PublicApp';

// 公開ホームはISR（5分）。ここが動的レンダリングに落ちないことが最重要。
// 落ちるとVercelが `Cache-Control: private, no-cache, no-store` を付けてCDNキャッシュを完全に捨て、
// 全アクセスが関数のコールドスタートを踏む（本番実測: ウォーム0.18s / コールド2.66〜3.83s）。
// 動的化の引き金は2つあり、両方を外してある:
//   ① cookies/auth  → auth()を読まない getPublicCoreData のみを使う（getCoreDataは使わない）
//   ② searchParams  → 旧OG用の ?article= / ?report= は middleware.ts で独立URLへリダイレクト。
//                      ここで searchParams を読むと再び動的化するので参照しないこと。
// ページ固有の metadata は layout.tsx のサイト共通metadataを継承する。
export const revalidate = 300;

export default async function Page() {
  // 公開ホームの初期フィードをSSRで先に取得してRSCに載せる。これにより /about 等の
  // intercept経由ページから / へ戻った直後に Client Server Action へ依存せず即描画でき、
  // ナビゲーション中断によるabort（=空スケルトンで止まる）を回避する。
  // 上から順ロード: SSRでは「見た目の部分」=先頭12件(PublicApp の ABOVE_FOLD と一致)のみawaitして
  // 最初のHTMLを軽くする。フィード残り・統計・推薦はクライアントが波で後追いする（PublicApp参照）。
  // 定数はPublicApp('use client')からimportすると値がundefinedになる（limit=NaN→全件化）ためリテラルで持つ。
  let initialPublic: PublicInitial | null = null;
  try {
    // 保険のタイムアウト。ISR化により、ここが走るのは「5分に1度の再生成」だけで、しかも
    // stale-while-revalidate でユーザーを待たせない裏側の処理になった。よって旧2.5秒のような
    // 短い打ち切りは不要で、むしろデータを載せ切る方が良い（8秒は異常時の保険）。
    const core = await Promise.race([
      getPublicCoreData(12).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    // 空フィードは信用しない。内部のサブ取得はDBエラーを握り潰して空配列を返すため、
    // Turso瞬断などの一過性失敗が「記事0件の成功」としてISRにキャッシュされると5分間その空が配られる。
    // 空なら null にしてクライアント取得（リトライ付き）へフォールバックさせる。
    if (core && Array.isArray(core.data) && core.data.length > 0) {
      initialPublic = {
        data: core.data as PublicInitial['data'],
        reportsData: core.reportsData as PublicInitial['reportsData'],
        counts: core.counts as PublicInitial['counts'],
        highlights: core.highlights as PublicInitial['highlights'],
      };
    }
  } catch {
    initialPublic = null;
  }
  return <PublicApp initialData={initialPublic} />;
}
