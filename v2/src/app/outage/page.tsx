import type { Metadata } from 'next';
import { OutageNotice } from '@/components/OutageNotice';

/**
 * DBに到達できないときの受け皿。**middleware から rewrite で入る**（src/middleware.ts の toOutage）。
 *
 * ⚠ なぜ専用ルートが要るか（2026-09-15・ローカル本番ビルドで実測）:
 *   障害画面を `/articles/[id]` の中で return すると、それは**描画の成功**なので
 *   Next はその結果をISRに格納する。実際 `.next/server/app/articles/26178.html` に
 *   障害画面が書き出され `s-maxage=3600` で配られていた（本番でも `X-Nextjs-Prerender: 1`）。
 *   **復旧しても最大1時間「お見せできません」を配り続ける**のが実害。
 *
 *   逃げ道を2つ測って、どちらも使えないと分かった:
 *   ① `throw` する → キャッシュは確かに書かれない（docs どおり）。だが ISR の生成中の例外は
 *      エラー境界に落ちず、**素の "Internal Server Error"（21バイト）**が返る。
 *   ② `await connection()` してから return → 同じく 500。ISRルートの中では呼べない。
 *   ⇒ 「ISRルートの中で障害を描く」限りキャッシュ汚染か白画面かの二択になる。
 *      だから**ISRルートに入る前に middleware で逃がす**。ここは force-dynamic なので格納されない。
 *
 * ⚠ 失うもの: 障害中でも既にキャッシュ済みの記事は読めていたが、middleware は
 *   キャッシュより手前で走るのでそれも障害画面になる。ただし `revalidate = 3600` なので
 *   その利点は**障害開始から最大1時間しか存在しない**（2026-09-14からの障害では既に消えていた）。
 *   一方こちらが防ぐ汚染は障害中ずっと＋復旧後1時間続く。差し引きで交換する価値がある。
 */
export const dynamic = 'force-dynamic';

const WHAT: Record<string, string> = {
  articles: '記事',
  reports: 'レポート',
  topic: 'このトピック',
};

function whatOf(k: string | string[] | undefined): string {
  return WHAT[typeof k === 'string' ? k : ''] ?? 'この画面';
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ k?: string }> }): Promise<Metadata> {
  const sp = await searchParams;
  // 障害中のタイトルが共有カードやブックマークに焼き付かないよう noindex を明示する。
  return { title: `いま${whatOf(sp.k)}をお見せできません`, robots: { index: false, follow: false } };
}

export default async function OutagePage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const sp = await searchParams;
  return <OutageNotice what={whatOf(sp.k)} />;
}
