import type { Metadata } from 'next';
import { RSS_ALTERNATE_TYPES } from '@/lib/site';
import { getPublicCoreData } from '../actions';
import { PublicApp, type PublicInitial } from '@/components/public/PublicApp';

// 集めた記事の一覧（川）。2026-09-11 まではトップ `/` がこれだった。
// トップは今朝の朝刊にしたので、朝刊に載らなかったものを自分で探したい人のためのページとして
// ここへ降ろした。朝刊と役割が重なるもの（最新レポートのカード・今日の注目）はここには置かない。
export const metadata: Metadata = {
  title: '記事を探す',
  description: '朝刊に載らなかったものも含めて、集めたAI技術の記事を新しい順に見られます。',
  // ⚠ canonical は「クエリを落とした /articles」に固定する。
  // このページは searchParams を読まない（下の理由で読めない）ので、`?page=2` も `?page=999` も
  // **同じHTML**を200で返す＝無限のURLで同一内容を配る重複コンテンツの生成器になっていた
  // （2026-09-12 監査: robots メタも canonical も無し）。中身が本当に同一なのだから、
  // noindex ではなく canonical で1本に寄せるのが正しい扱い。続きは下の「もっと読む」で辿る。
  alternates: { canonical: '/articles', types: RSS_ALTERNATE_TYPES },
};

// 公開ページはISR（5分）。ここが動的レンダリングに落ちないことが最重要。
// 落ちるとVercelが `Cache-Control: private, no-cache, no-store` を付けてCDNキャッシュを完全に捨て、
// 全アクセスが関数のコールドスタートを踏む（本番実測: ウォーム0.18s / コールド2.66〜3.83s）。
// 動的化の引き金は2つあり、両方を外してある:
//   ① cookies/auth  → auth()を読まない getPublicCoreData のみを使う（getCoreDataは使わない）
//   ② searchParams  → 旧OG用の ?article= / ?report= は middleware.ts で独立URLへリダイレクト。
//                      ここで searchParams を読むと再び動的化するので参照しないこと。
export const revalidate = 300;

export default async function ArticlesPage() {
  // 初期フィードをSSRで先に取得してRSCに載せる。これにより他ページから戻った直後に
  // Client Server Action へ依存せず即描画でき、ナビゲーション中断によるabort（=空スケルトンで止まる）を回避する。
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
        counts: core.counts as PublicInitial['counts'],
      };
    }
  } catch {
    initialPublic = null;
  }
  return <PublicApp initialData={initialPublic} />;
}
