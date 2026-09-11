import Link from 'next/link';
import { SITE_NAME } from '@/lib/site';
import s from '@/styles/brand.module.css';

/**
 * 表側（トップ／過去の朝刊／紹介ページ）で共通のナビとフッタ。
 * 3ページに同じマークアップをコピーすると必ず片方だけ古くなるのでここに1つだけ置く。
 */

/** `minor: true` は、画面が狭いときに最初に落とすリンク（フッタにも置いてあるもの）。 */
export type NavLink = { href: string; label: string; minor?: boolean };

export function BrandNav({ links, cta, right }: { links: NavLink[]; cta?: NavLink; right?: React.ReactNode }) {
  return (
    <nav className={s.nav}>
      <div className={s.navInner}>
        <Link className={s.navBrand} href="/">{SITE_NAME}</Link>
        <div className={s.navLinks}>
          {links.map(l => (
            l.href.startsWith('#')
              ? <a key={l.href} href={l.href} className={l.minor ? s.navMinor : undefined}>{l.label}</a>
              : <Link key={l.href} href={l.href} className={l.minor ? s.navMinor : undefined}>{l.label}</Link>
          ))}
        </div>
        {/* 右端は「CTA」か「操作(検索・ログイン等)」のどちらか。両方無いページでも
            space-between のためのダミーを置いて、ワードマークが中央に寄らないようにする。 */}
        {right ? <div className={s.navRight}>{right}</div>
          : cta ? <Link className={s.navCta} href={cta.href}>{cta.label}</Link>
          : <span />}
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
