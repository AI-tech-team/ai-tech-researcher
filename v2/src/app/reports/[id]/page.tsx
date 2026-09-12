import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { getReportById, getAdjacentReports } from '@/app/actions';
import { parseDigest, digestReadingSeconds } from '@/lib/digest';
import { BrandNav, BrandFooter } from '@/components/digest/BrandChrome';
import { IssueHeader } from '@/components/digest/IssueHeader';
import { DigestBody } from '@/components/digest/DigestBody';
import { JsonLd } from '@/components/JsonLd';
import s from '@/styles/brand.module.css';

const TYPE_LABEL: Record<string, string> = { daily: '朝刊', weekly: '週次のまとめ', monthly: '月次のまとめ' };

// 号ごとの全画面ページ。直リンク/リロード/共有/検索インデックス向けにSSRする。
// 版面はトップ（今朝の朝刊）と同じ（`DigestBody`）。過去の号だけ別の見た目になると、
// リンクを踏んだ読者には「別のサイトに来た」ように見える。
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const report = await getReportById(Number(id));
  if (!report) return { title: 'レポートが見つかりません' };
  const label = TYPE_LABEL[report.type] ?? 'レポート';
  const title = `${label} ${report.reportDate}`;
  const description = `${SITE_NAME} の${label}（${report.reportDate}）。`;
  return {
    title, description,
    openGraph: { title, description, type: 'article', url: `/reports/${id}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

// ISR。cookiesを読まない取得のみで構成されているため静的化でき、CDNから配れる＝
// Vercel関数のコールドスタート（本番実測でトップは2.66〜3.83秒）を踏まない。レポートは生成後に変わらないので長め。
// 空配列＝ビルド時は事前生成しない。動的セグメントは generateStaticParams が無いと
// ISRの対象にならず毎回オンデマンド実行になるため、空でも宣言してキャッシュに乗せる
// （未知のidは dynamicParams のデフォルト true で初回生成→以後キャッシュ）。
export async function generateStaticParams() { return []; }

export const revalidate = 3600;

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReportById(Number(id));
  if (!report) notFound();

  const label = TYPE_LABEL[report.type] ?? 'レポート';
  const content = report.content ?? '';
  const parsed = parseDigest(content);
  const seconds = digestReadingSeconds(content);
  const adj = await getAdjacentReports(report.type, report.reportDate);

  // レポートは自前生成のIP → Article として構造化（記事ページは第三者著作なので付けない）。
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${label} ${report.reportDate ?? ''}`.trim(),
    ...(report.reportDate ? { datePublished: report.reportDate, dateModified: report.reportDate } : {}),
    inLanguage: 'ja',
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png` } },
    image: `${SITE_URL}/icon-512.png`,
    description: `${SITE_NAME} の${label}（${report.reportDate ?? ''}）。`,
    mainEntityOfPage: `${SITE_URL}/reports/${id}`,
  };

  return (
    <div className={s.page}>
      <JsonLd data={articleJsonLd} />
      <BrandNav />

      <IssueHeader
        eyebrow={report.type === 'daily' ? 'バックナンバー' : label}
        title={label}
        reportDate={report.reportDate}
        seconds={seconds}
        picked={parsed.highlights.length}
      />

      <main id="main-content" className={`${s.bandPaper} ${s.paper}`}>
        <DigestBody digest={parsed} />
      </main>

      <section className={`${s.bandInk} ${s.band}`} style={{ paddingBlock: 64 }}>
        <div className={s.measure}>
          <p className={`${s.eyebrow} ${s.eyebrowInk}`}>前後の号</p>
          <div className={s.backList}>
            {adj.prev && (
              <Link className={s.backItem} href={`/reports/${adj.prev.id}`}>
                <span className={s.backDate}>{adj.prev.reportDate}</span>
                <span className={s.backLabel}>前の{label}</span>
                <span className={s.backGo}>読む ›</span>
              </Link>
            )}
            {adj.next && (
              <Link className={s.backItem} href={`/reports/${adj.next.id}`}>
                <span className={s.backDate}>{adj.next.reportDate}</span>
                <span className={s.backLabel}>次の{label}</span>
                <span className={s.backGo}>読む ›</span>
              </Link>
            )}
          </div>
          <div className={s.row} style={{ marginTop: 30 }}>
            <Link className={`${s.btn} ${s.btnSolid}`} href="/">今朝の朝刊を読む</Link>
            <Link className={`${s.btn} ${s.btnGhost}`} href="/articles">記事を探す&nbsp;›</Link>
          </div>
        </div>
      </section>

      <BrandFooter />
    </div>
  );
}
