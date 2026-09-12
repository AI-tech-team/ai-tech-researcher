"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession, signIn, signOut } from 'next-auth/react';
import { LogIn, LogOut, Search, MessageSquare, Shield, ChevronDown, User, ScrollText, MoreHorizontal, History, Info } from 'lucide-react';
import s from '@/styles/brand.module.css';
import { SearchPalette } from '@/components/public/SearchPalette';
import { ProfileModal } from '@/components/public/ProfileModal';
import { PushToggle } from '@/components/public/PushToggle';
import { ThemeToggle } from '@/components/public/ThemeToggle';
import { CONTACT_EMAIL, FEEDBACK_FORM_ACTION } from '@/lib/site';
import { useScrollLock } from '@/lib/useScrollLock';

/**
 * マストヘッド右側の操作（検索・その他メニュー・アカウント）。
 *
 * なぜ1コンポーネントに切り出すか（2026-09-12）: 以前はトップバーの中身がページごとに違い
 * （記事一覧だけ検索とアカウント、規約系は「トップへ戻る」だけ）、ページを移るたびに
 * 上の段が組み替わって見えていた＝「うざい」と指摘された箇所。バーは全ページで同一にする。
 */
export function BrandNavActions() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoMenuOpen, setInfoMenuOpen] = useState(false);
  const feedbackAvailable = !!FEEDBACK_FORM_ACTION || !!CONTACT_EMAIL;

  // 「…」メニューの開閉はタップ/クリックだけで完結させる。指には hover が無く、
  // ホバー閉じを併用すると「開いた直後に合成された mouseleave で閉じる」事故になる。
  // 外側クリックは覆い被せ用divではなくdocumentリスナで判定（divで覆うとボタンを隠すため）。
  const infoMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!infoMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (infoMenuRef.current && !infoMenuRef.current.contains(e.target as Node)) setInfoMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [infoMenuOpen]);

  // ⌘K / Ctrl+K でグローバル検索を開く
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // overflow:hidden は iOS Safari で効かないため position:fixed 方式の共通フックに統一
  useScrollLock(searchOpen || profileOpen);

  return (
    <>
      {/* 検索: デスクトップは⌘Kヒント付きのピル、モバイルはアイコン。
          幅の出し分けは module 側のクラスで行う。Tailwindの hidden / sm:inline-flex は
          @layer utilities に入るため、層の外にある .navBtn の display に必ず負ける。 */}
      <button onClick={() => setSearchOpen(true)} title="記事を検索 (⌘K)" aria-label="記事を検索"
        className={`${s.navBtn} ${s.navPill} ${s.navWide}`}>
        <Search size={14} /> 検索 <span className={s.navKbd}>⌘K</span>
      </button>
      <button onClick={() => setSearchOpen(true)} title="記事を検索" aria-label="記事を検索"
        className={`${s.navBtn} ${s.navNarrow}`}>
        <Search size={18} />
      </button>

      {/* … メニュー: 配色・規約類・通知をまとめる */}
      <div ref={infoMenuRef} className={s.navMenuWrap}>
        <button onClick={() => setInfoMenuOpen(v => !v)} title="メニュー" aria-label="メニュー"
          aria-expanded={infoMenuOpen} className={s.navBtn}>
          <MoreHorizontal size={18} />
        </button>
        {infoMenuOpen && (
          <div className={s.navMenu}>
            <p className={s.navMenuHead}>配色</p>
            <div style={{ padding: '0 14px 8px' }}><ThemeToggle onDark /></div>
            <div className={s.navMenuSep} />
            <Link href="/about" scroll={false} onClick={() => setInfoMenuOpen(false)} className={s.navMenuItem}>
              <Info size={14} /> このサービスについて
            </Link>
            {feedbackAvailable && (
              <Link href="/feedback" scroll={false} onClick={() => setInfoMenuOpen(false)} className={s.navMenuItem}>
                <MessageSquare size={14} /> フィードバック
              </Link>
            )}
            <Link href="/privacy" scroll={false} onClick={() => setInfoMenuOpen(false)} className={s.navMenuItem}>
              <Shield size={14} /> プライバシー
            </Link>
            <Link href="/terms" scroll={false} onClick={() => setInfoMenuOpen(false)} className={s.navMenuItem}>
              <ScrollText size={14} /> 利用規約
            </Link>
            <Link href="/changelog" scroll={false} onClick={() => setInfoMenuOpen(false)} className={s.navMenuItem}>
              <History size={14} /> 更新履歴
            </Link>
            {/* 通知トグル（未対応環境・VAPID未設定なら自動で非表示） */}
            <div className={s.navMenuSep} />
            <PushToggle loggedIn={!!session?.user} onDone={() => setInfoMenuOpen(false)} />
          </div>
        )}
      </div>

      {/* アカウント */}
      {status === 'loading' ? (
        <div className={s.navAvatar} style={{ background: 'rgba(255,255,255,.1)' }} />
      ) : session?.user ? (
        <div className={s.navMenuWrap}>
          {/* アカウント＝1つのメニューに集約。ログアウトは中に隠す＋確認を出す（誤操作防止） */}
          <button onClick={() => setMenuOpen(v => !v)} title="アカウント" aria-label="アカウント"
            aria-expanded={menuOpen} className={s.navBtn}>
            {session.user.image
              /* Googleアバター(26px・外部画像)。next/imageに通すとVercel画像最適化課金が乗る割に
                 効果が無いため<img>のまま。寸法明示＋no-referrerで安定描画。 */
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={session.user.image} alt="" width={26} height={26} loading="lazy" referrerPolicy="no-referrer" className={s.navAvatar} />
              : <User size={18} />}
            <ChevronDown size={12} style={{ transform: menuOpen ? 'rotate(180deg)' : undefined }} />
          </button>
          {menuOpen && (
            <>
              {/* 外側クリックで閉じる */}
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className={s.navMenu}>
                {session.user.email && (
                  <p className={s.navMenuHead} style={{ textTransform: 'none', letterSpacing: 0 }}>{session.user.email}</p>
                )}
                <button onClick={() => { setMenuOpen(false); setProfileOpen(true); }} className={s.navMenuItem}>
                  <User size={14} /> プロフィール
                </button>
                <button onClick={() => { setMenuOpen(false); if (window.confirm('ログアウトしますか？')) signOut(); }}
                  className={s.navMenuItem}>
                  <LogOut size={14} /> ログアウト
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button onClick={() => signIn('google')} title="ログイン" aria-label="ログイン"
          className={`${s.navBtn} ${s.navPill}`}>
          <LogIn size={14} /> <span className={s.navLabel}>ログイン</span>
        </button>
      )}

      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(id) => { setSearchOpen(false); router.push(`/articles/${id}`, { scroll: false }); }}
      />
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
