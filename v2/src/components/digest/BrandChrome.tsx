import Link from 'next/link';
import { SITE_NAME } from '@/lib/site';
import s from '@/styles/brand.module.css';
import { BrandNavActions } from '@/components/digest/BrandNavActions';

/**
 * 全ページ共通のナビとフッタ。
 *
 * 2026-09-12: リンクも右側の操作も**引数で変えられないようにした**。以前は
 * ページごとに links / cta を渡していたため、朝刊・記事一覧・紹介ページ・規約類で
 * 上の段の中身が毎回組み替わり、「ページごとに変わってうざい」と指摘された。
 * バーは1つ。どのページから見ても同じ位置に同じものがある状態を維持する。
 */

/** `minor: true` は、画面が狭いときに最初に落とすリンク（フッタにも置いてあるもの）。 */
type NavLink = { href: string; label: string; minor?: boolean };

// ⚠ ここに項目を足すのは慎重に。「マニアックなものはマニアックな位置に置く」（本人・2026-09-12）。
//
// 2026-09-13: 「トピック」をここから降ろした。降ろした理由は3つとも実測:
//   - entities 1,649件のうち **81.5% が mention_count=1**（一度しか出てこない名前の一覧になっていた）
//   - 関連記事の並びが importance 順だけで、**中央値94日前・最古115日前**を出していた
//   - 関係タイプは誤情報リスクで非表示にしたため、「関連トピック」は意味の無い名前の羅列だった
// 知識グラフは作り手側の都合であって、読者が朝いちばんに押すものではない。
// 導線は残す: 記事詳細のタグ、フッタの「トピック一覧」、sitemap。消したのは**この位置だけ**。
const NAV: NavLink[] = [
  { href: '/articles', label: '記事を探す' },
  // スマホで入りきらないときに最初に落とす（フッタにも同じリンクがある）。
  { href: '/about', label: 'このサービスについて', minor: true },
];

export function BrandNav() {
  return (
    <nav className={s.nav}>
      <div className={s.navInner}>
        {/* ワードマークが「今朝の朝刊へ戻る」を兼ねる。だから朝刊はリンク一覧に置かない。 */}
        <Link className={s.navBrand} href="/">{SITE_NAME}</Link>
        <div className={s.navLinks}>
          {NAV.map(l => (
            <Link key={l.href} href={l.href} className={l.minor ? s.navMinor : undefined}>{l.label}</Link>
          ))}
        </div>
        <div className={s.navRight}><BrandNavActions /></div>
      </div>
    </nav>
  );
}

export function BrandFooter() {
  return (
    <footer className={s.foot}>
      <div className={s.footInner}>
        <span>{SITE_NAME} — AI技術の朝刊</span>
        <div className={s.footLinks}>
          <Link href="/about">このサービスについて</Link>
          <Link href="/privacy">プライバシー</Link>
          <Link href="/terms">利用規約</Link>
          <Link href="/changelog">更新履歴</Link>
        </div>
        <span>読了時間は 600字/分で算出</span>
      </div>
    </footer>
  );
}
