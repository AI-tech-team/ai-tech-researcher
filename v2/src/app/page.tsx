import type { Metadata } from 'next';
import { getArticleById, getReportById, getCoreData } from './actions';
import { PublicApp, type PublicInitial } from '@/components/public/PublicApp';
import { SITE_URL, SITE_NAME } from '@/lib/site';

// シェア時のOG/Twitterカードを動的生成。?article=N または ?report=N が付いていれば
// その記事/レポートのタイトル・サマリーで上書きする。LLM追加コストなし（DB参照のみ）。
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ article?: string; report?: string }> },
): Promise<Metadata> {
  const sp = await searchParams;
  const articleId = sp.article ? Number(sp.article) : NaN;
  const reportId = sp.report ? Number(sp.report) : NaN;

  if (Number.isFinite(articleId)) {
    const a = await getArticleById(articleId).catch(() => null);
    if (a) {
      const title = (a.titleJa || a.title || '無題').slice(0, 80);
      const desc = (a.summary ?? '').slice(0, 200);
      const url = `${SITE_URL}/?article=${articleId}`;
      return {
        title,
        description: desc,
        openGraph: { title, description: desc, url, siteName: SITE_NAME, type: 'article', locale: 'ja_JP' },
        twitter: { card: 'summary_large_image', title, description: desc },
      };
    }
  }

  if (Number.isFinite(reportId)) {
    const r = await getReportById(reportId).catch(() => null);
    if (r) {
      const typeLabel = r.type === 'weekly' ? '週次レポート' : r.type === 'monthly' ? '月次レポート' : 'デイリーレポート';
      const title = `${typeLabel} ${r.reportDate}`;
      const lead = (r.content ?? '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[#*_`>]/g, '')
        .replace(/\[ID:\d+\]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      const url = `${SITE_URL}/?report=${reportId}`;
      return {
        title,
        description: lead,
        openGraph: { title, description: lead, url, siteName: SITE_NAME, type: 'article', locale: 'ja_JP' },
        twitter: { card: 'summary_large_image', title, description: lead },
      };
    }
  }

  // デフォルトは layout.tsx の site-wide metadata を継承
  return {};
}

export default async function Page() {
  // 公開ホームの初期フィードをSSRで先に取得してRSCに載せる。これにより /about 等の
  // intercept経由ページから / へ戻った直後に Client Server Action(getCoreData)へ依存せず
  // 即描画でき、ナビゲーション中断によるabort（=空スケルトンで止まる）を回避する。
  // Vercel⇄Turso同リージョンでサーバ取得は速く、TTFB増は小さい。失敗時はnull（従来どおりClient取得）。
  let initialPublic: PublicInitial | null = null;
  try {
    const core = await getCoreData(30);
    // 空フィードは信用しない。getCoreData の内部サブ取得はDBエラーを握り潰して空配列を返すため、
    // Turso瞬断などSSRの一過性失敗で initialData が「記事0件の成功」になり、クライアント再取得も
    // スキップされて「記事がまだありません」で固定化する。空なら null にしてクライアント取得
    // （リトライ付き）へフォールバックさせる。本番コーパスは非空なので空=ほぼ一過性失敗。
    if (Array.isArray(core.data) && core.data.length > 0) {
      initialPublic = {
        data: core.data as PublicInitial['data'],
        reportsData: core.reportsData as PublicInitial['reportsData'],
        counts: core.counts as PublicInitial['counts'],
      };
    }
  } catch {
    initialPublic = null;
  }
  return <PublicApp initialData={initialPublic} />;
}
