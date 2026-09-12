"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn, ArrowRight, Newspaper, Bookmark, X, Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/Toast';
import {
  getCoreData, getCollectedDataList, getKnowledgeStats,
  getMyReadLater,
  toggleFavorite, toggleReadLater,
  getMyProfile, subscribeEmailDigest,
} from '@/app/actions';
import { BrandNav } from '@/components/digest/BrandChrome';
import s from '@/styles/brand.module.css';
import { SavedItemsModal } from '@/components/public/SavedItemsModal';
import type { CollectedItem, KnowledgeStats } from '@/types';
import { noSummaryReason } from '@/lib/no-summary';
import { CONTACT_EMAIL, FEEDBACK_FORM_ACTION, SITE_TAGLINE } from '@/lib/site';
import { useScrollLock } from '@/lib/useScrollLock';
import { CATEGORY_COLORS } from '@/lib/category-colors';



const PAGE = 30;
// 上から順ロード: 第1波で描く「見た目の部分」の記事件数（注目＋レポート＋件数と同時に取得）。
// 残り(〜PAGE)は第2波でフィードを差し替えて埋める。page.tsx(SSR)も同じ12件で初期取得する
// （'use client'モジュールのexportはサーバからimportすると値が消えるためあちらはリテラルで保持）。
const ABOVE_FOLD = 12;

// ページ遷移(記事/規約/プライバシー等)→戻る でPublicAppが再マウントされても、直前の一覧を即座に
// 復元してローディングのちらつき(=再読み込み感)を防ぐ、モジュールレベルの簡易スナップショット。
// 同一ブラウザ内のみ・短時間TTL。ログイン/ログアウトはOAuthのフルリロードで自然にクリアされる。
type PubSnapshot = {
  items: CollectedItem[]; total: number | null;
  offset: number; hasMore: boolean; stats: KnowledgeStats | null; at: number;
};
let pubSnapshot: PubSnapshot | null = null;
const SNAP_TTL = 5 * 60_000;

/**
 * 記事へ出ていったときのスクロール位置。戻ってきたら1回だけ使って捨てる。
 *
 * なぜ要るか（2026-09-11）: 一覧をトップ `/` から `/articles` へ降ろしたことで、記事は
 * オーバーレイでなく全画面ページになった。`/articles/[id]` は `/articles` の**子**なので、
 * インターセプト（`(.)`/`(..)` のどちらでも）が効かない＝親の一覧に重ねられない。
 * ブラウザの復元は「一覧が描かれる前」に走るため必ず先頭に戻ってしまう（実機で確認）。
 * そこで出ていく瞬間の位置を覚えておき、一覧が描き終わってから戻す。
 */
let pubScrollY: number | null = null;

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (h < 1) return 'たった今';
  if (h < 24) return `${h}時間前`;
  if (d < 7) return `${d}日前`;
  return new Date(dateStr).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

// 記事一覧の1件。以前は「今日の一押し(lead)」「見どころ(featured)」で大きさを変えていたが、
// 記事を前に出して強弱を付けるのは朝刊の仕事なので、一覧では全部同じ大きさにした（2026-09-11）。
// 2026-09-12: 箱（角丸カード＋影）をやめ、罫だけで仕切る行にした。朝刊の「過去の号」と同じ組み方で、
// 表と裏で紙面の作りが揃う。
function PubCard({ item }: { item: CollectedItem }) {
  const color = CATEGORY_COLORS[item.category ?? ''] ?? 'var(--cat-other)';
  const title = item.titleJa || item.title || '無題';
  const outlets = item.storyOutlets ?? [];
  const multi = (item.storyCount ?? 1) > 1 && outlets.length > 0;
  return (
    // scroll={false} 必須: 付けないと Next.js が @modal スロット(DOM上はフィードの後ろ)まで
    // ウィンドウをスクロールさせ、オーバーレイを開いた瞬間に背面が最下部へ飛ぶ。
    <Link href={`/articles/${item.id}`} scroll={false}
      onClick={() => { pubScrollY = window.scrollY; }}
      className={s.riverItem}>
      <div className={s.riverTop}>
        <span className={s.riverCat} style={{ color }}>{item.category ?? 'OTHER'}</span>
        {multi && (
          <span title={outlets.join('、')} className={s.riverMulti}>
            <Newspaper size={11} />{outlets.length}媒体が報じた
          </span>
        )}
        <span className={s.riverTime}>{timeAgo(item.publishedAt ?? item.createdAt)}</span>
      </div>
      <h3 className={s.riverTitle}>{title}</h3>
      {/* 3行まで表示（要約は平均150字前後あり、2行だと内容が伝わらないという指摘への対応） */}
      {item.summary ? (
        <p className={s.riverSummary}>{item.summary}</p>
      ) : (() => {
        // 要約が無いとき、以前はここが空欄だった。読者には「壊れている」としか見えず、
        // 見出しだけで要約を書かないという判断がまったく伝わらない。理由を書く（src/lib/no-summary.ts）。
        // 警告色は使わない ── これは不具合ではなく設計判断なので。
        const r = noSummaryReason(item);
        if (!r) return null;
        return <p className={s.riverNote}>{r.text}</p>;
      })()}
      <div className={s.riverFoot}>
        {item.tags?.slice(0, 3).map(t => <span key={t}>#{t}</span>)}
        {item.sourceValue && <span className={s.riverSource}>{item.sourceValue}</span>}
      </div>
    </Link>
  );
}

// page.tsx(サーバ)がSSRで先に取得して渡す初期フィード。これがあれば初回/遷移直後に
// Client Server Action(getCoreData)を叩かずに描画できる＝@modal遷移時のabortを踏まない。
export type PublicInitial = { data: CollectedItem[]; counts: { total: number } };

export function PublicApp({ initialData }: { initialData?: PublicInitial | null }) {
  const { toast } = useToast();
  const router = useRouter();
  const { data: session, status } = useSession();
  const sessionUserId = (session?.user as { id?: number } | undefined)?.id;

  // 初期値は スナップショット(戻り) → SSR初期データ → 空 の順で復元。
  // いずれかがあれば即表示・スケルトンを出さない（戻りのちらつき＆遷移直後の空表示を防ぐ）。
  const [collectedItems, setCollectedItems] = useState<CollectedItem[]>(() => pubSnapshot?.items ?? initialData?.data ?? []);
  const [stats, setStats] = useState<KnowledgeStats | null>(() => pubSnapshot?.stats ?? null);
  const [totalArticles, setTotalArticles] = useState<number | null>(() => pubSnapshot?.total ?? initialData?.counts?.total ?? null);
  const [readLater, setReadLater] = useState<CollectedItem[]>([]);
  const [isLoading, setIsLoading] = useState(() => !pubSnapshot && !initialData);
  const [offset, setOffset] = useState(() => pubSnapshot?.offset ?? initialData?.data.length ?? 0);
  // initialData は第1波(先頭ABOVE_FOLD件)なので常に続きがある前提でtrue。第2波/loadMoreで実値に補正する。
  const [hasMore, setHasMore] = useState(() => pubSnapshot?.hasMore ?? true);
  const [loadingMore, setLoadingMore] = useState(false);
  // 第2波(フィード残りの後追い取得)の実行中フラグ。上から順に埋まる様子をスケルトンで示す＋
  // 途中状態をスナップショットに焼き付けない（戻り時に先頭12件で固定化するのを防ぐ）。
  const [belowFoldPending, setBelowFoldPending] = useState(false);

  // 検索・プロフィール・各メニューはマストヘッド側（BrandNavActions）が持つ。
  // ここに残すと全ページ共通のバーと状態が二重になる。
  const [savedOpen, setSavedOpen] = useState(false);
  const [digestPromptOpen, setDigestPromptOpen] = useState(false);

  // scroll: false 必須（Linkのscroll={false}と同じ理由）。付けないとオーバーレイを開いた瞬間に
  // Next.js が @modal スロットの位置まで背面をスクロールさせてしまう。
  const openArticle = (id: number) => router.push(`/articles/${id}`, { scroll: false });

  // ログイン済みで未購読なら「毎朝ダイジェスト」購読プロンプトを一度だけ出す（同意ベース）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!sessionUserId) { setDigestPromptOpen(false); return; }
    try {
      if (typeof window !== 'undefined' && localStorage.getItem('digest_prompt_v1_dismissed')) return;
    } catch {}
    let cancelled = false;
    getMyProfile().then(p => {
      if (cancelled || !p) return;
      if (!p.emailOptIn) setDigestPromptOpen(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [sessionUserId]);
  const dismissDigestPrompt = () => {
    setDigestPromptOpen(false);
    try { localStorage.setItem('digest_prompt_v1_dismissed', '1'); } catch {}
  };
  const subscribeDigest = async () => {
    try {
      const r = await subscribeEmailDigest();
      toast(r?.success ? '毎朝のダイジェストを登録しました📩' : '登録に失敗しました', r?.success ? 'success' : 'error');
    } catch { toast('登録に失敗しました', 'error'); }
    dismissDigestPrompt();
  };

  // モーダル表示中は背面のスクロールを止める（スマホで背面がスクロールする問題の対策）。
  // overflow:hidden は iOS Safari で効かないため、position:fixed 方式の共通フックに統一。
  useScrollLock(savedOpen);

  useEffect(() => {
    let cancelled = false;
    // 戻りのスナップショットが新鮮なら全状態が揃っている＝何も取得しない（従来どおり・abort回避）。
    const snapFresh = !!pubSnapshot && Date.now() - pubSnapshot.at < SNAP_TTL;
    // stats(第3波)は初期データに含めていないので別途取得（軽量）。snapshotに無いときだけ。
    if (!stats) getKnowledgeStats().then(s => { if (!cancelled) setStats(s as KnowledgeStats); }).catch(() => {});
    if (snapFresh) return () => { cancelled = true; };
    (async () => {
      // ── 第1波: 見た目の部分（注目＋レポート＋件数＋先頭ABOVE_FOLD件）。──
      // 画面に出せる記事が何も無い時だけ取得（SSRのinitialData or 期限切れスナップショットが既にあれば省略）。
      if (collectedItems.length === 0) {
        setIsLoading(true);
        // ナビゲーション中断でabortされても無限スケルトンで止まらないよう数回リトライ。
        for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
          try {
            const { data, counts } = await getCoreData(ABOVE_FOLD);
            if (cancelled) return;
            const first = data as CollectedItem[];
            setCollectedItems(first);
            setOffset(first.length);
            setTotalArticles((counts as { total: number }).total);
            setIsLoading(false);
            break;
          } catch {
            if (cancelled) return;
            if (attempt === 2) { setIsLoading(false); return; }
            await new Promise(r => setTimeout(r, 400));
          }
        }
      }
      if (cancelled) return;
      // ── 第2波: フィード残り（フルページ）を後追いで取得し、上から順に埋める。──
      setBelowFoldPending(true);
      try {
        const full = (await getCollectedDataList(PAGE, 0)) as CollectedItem[];
        if (cancelled) return;
        setCollectedItems(full);
        setOffset(full.length);
        setHasMore(full.length === PAGE);
      } catch {
        // 失敗時は第1波の先頭件のまま。hasMoreはtrueのままなので「もっと読む」で継続可能。
      } finally {
        if (!cancelled) setBelowFoldPending(false);
      }
    })();
    return () => { cancelled = true; };
    // 初回マウント時のみ実行（initialData/statsはマウント時点の値で判定する意図）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 表示状態をスナップショットへ同期（loadMoreで増えた件数・お気に入り等のトグルも、戻った時に復元する）。
  useEffect(() => {
    // 第1波だけ／第2波の途中では焼き付けない（戻り時に先頭12件で固定化するのを防ぐ）。
    if (isLoading || belowFoldPending) return;
    pubSnapshot = { items: collectedItems, total: totalArticles, offset, hasMore, stats, at: Date.now() };
  }, [collectedItems, totalArticles, offset, hasMore, stats, isLoading, belowFoldPending]);

  // 記事から戻ってきたら、出ていったときの位置に戻す（1回きり）。
  // 一覧が描き終わる前に戻すと、まだ紙面が短くて目的の位置まで下がれないので、
  // 第2波（フィード残りの取得）が終わってから実行する。
  const scrollRestored = useRef(false);
  useEffect(() => {
    if (scrollRestored.current || pubScrollY == null) return;
    if (isLoading || belowFoldPending || collectedItems.length === 0) return;
    const y = pubScrollY;
    pubScrollY = null;
    scrollRestored.current = true;
    // ブラウザ／ルータ側の復元があとから走ってこちらを上書きすることがあるので、
    // 位置が合うまで短い間隔でやり直す（合っていれば1回で終わる）。届かない高さなら数回で諦める。
    let tries = 0;
    const tick = () => {
      window.scrollTo(0, y);
      if (++tries < 6 && Math.abs(window.scrollY - y) > 4) setTimeout(tick, 70);
    };
    requestAnimationFrame(tick);
  }, [isLoading, belowFoldPending, collectedItems.length]);

  // ログインユーザーの「後で読む」。未ログインでは何も出さない。
  // 行動ベース推薦（あなた向け）と読書DNAは2026-09-12に撤去した。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!sessionUserId) { setReadLater([]); return; }
    let cancelled = false;
    getMyReadLater()
      .then(rl => { if (!cancelled) setReadLater(rl as CollectedItem[]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionUserId]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = (await getCollectedDataList(PAGE, offset)) as CollectedItem[];
      setCollectedItems(prev => {
        const seen = new Set(prev.map(i => i.id));
        return [...prev, ...next.filter(i => !seen.has(i.id))];
      });
      setOffset(o => o + next.length);
      setHasMore(next.length === PAGE);
    } finally {
      setLoadingMore(false);
    }
  };

  // ログインが要る操作はトースト＋ログイン誘導
  const requireLogin = (msg: string) => { toast(msg, 'info'); signIn('google'); };

  const handleToggleFavorite = async (id: number, current: boolean) => {
    if (status === 'loading') return; // セッション解決中はクリックを無視（ログイン誤発火＝画面遷移を防ぐ）
    if (!sessionUserId) return requireLogin('お気に入りの保存にはログインが必要です');
    setCollectedItems(prev => prev.map(i => i.id === id ? { ...i, isFavorited: current ? 0 : 1 } : i));
    const rollback = () => { // 失敗時はロールバック（保存できていないのに保存済み表示にしない）
      setCollectedItems(prev => prev.map(i => i.id === id ? { ...i, isFavorited: current ? 1 : 0 } : i));
      toast('保存に失敗しました。少し時間をおいて再度お試しください', 'error');
    };
    try {
      const r = await toggleFavorite(id);
      if (!r?.success) rollback();
      // サーバの確定値で補正（多タブ等で楽観更新とズレた場合の整合）
      else if (typeof r.value === 'boolean') setCollectedItems(prev => prev.map(i => i.id === id ? { ...i, isFavorited: r.value ? 1 : 0 } : i));
    } catch {
      rollback();
    }
  };
  const handleToggleReadLater = async (id: number, current: boolean) => {
    if (status === 'loading') return; // セッション解決中はクリックを無視
    if (!sessionUserId) return requireLogin('「後で読む」の保存にはログインが必要です');
    const item = collectedItems.find(i => i.id === id) ?? readLater.find(i => i.id === id);
    setCollectedItems(prev => prev.map(i => i.id === id ? { ...i, isReadLater: current ? 0 : 1 } : i));
    // 「後で読む」一覧も同期（解除なら除外、追加なら一覧へ）。関数型更新で安全に
    setReadLater(prev => current
      ? prev.filter(i => i.id !== id)
      : (item && !prev.some(i => i.id === id) ? [{ ...item, isReadLater: 1 }, ...prev] : prev));
    const rollback = () => { // 失敗時はフラグ・一覧の両方をロールバック
      setCollectedItems(prev => prev.map(i => i.id === id ? { ...i, isReadLater: current ? 1 : 0 } : i));
      setReadLater(prev => current
        ? (item && !prev.some(i => i.id === id) ? [{ ...item, isReadLater: 1 }, ...prev] : prev)
        : prev.filter(i => i.id !== id));
      toast('保存に失敗しました。少し時間をおいて再度お試しください', 'error');
    };
    try {
      const r = await toggleReadLater(id);
      if (!r?.success) rollback();
      // サーバの確定値で補正（フラグと「後で読む」一覧の両方を同期）
      else if (typeof r.value === 'boolean') {
        const v = r.value;
        setCollectedItems(prev => prev.map(i => i.id === id ? { ...i, isReadLater: v ? 1 : 0 } : i));
        setReadLater(prev => v
          ? (item && !prev.some(i => i.id === id) ? [{ ...item, isReadLater: 1 }, ...prev] : prev)
          : prev.filter(i => i.id !== id));
      }
    } catch {
      rollback();
    }
  };
  const feedbackAvailable = !!FEEDBACK_FORM_ACTION || !!CONTACT_EMAIL;
  // 一覧は新着順の一本道（2026-09-11）。選別は朝刊の仕事に一本化した。
  // カテゴリ絞り込み（注目のテーマ）も2026-09-12に外した＝直近30件の内訳でしかなく、
  // 「何日以内か」を説明できない数字を読者に見せていた。
  const feed = collectedItems;

  return (
    <div className="min-h-screen overflow-y-auto">
      {/* ── トップバー ──
          表（朝刊）と同じ黒いマストヘッドを共有する。ここが別物だと、同じサイトの
          裏表ではなく「別のサイトに飛ばされた」ように見える（2026-09-12 に統一）。 */}
      <BrandNav />

      <main id="main-content" tabIndex={-1} className={`${s.listShell} outline-none pb-24`}>

        {/* ── ページの頭 ──
            ここは朝刊ではなく「朝刊に載らなかったものも含めた全部」。何のページかを最初に言う。
            朝刊と同じ「小さいラベル＋大きい見出し」の落差で組む（版面を表と揃える）。
            旧トップにあったログイン誘導のバナーは置かない（読むのにログインは要らない、という約束と矛盾する）。 */}
        <section className={s.listHead}>
          <p className={s.listEyebrow}>Archive</p>
          <h1 className={s.listTitle}>記事を探す</h1>
          <p className={s.listLead}>
            集めた記事を新しい順に並べています。今朝の分だけでよければ{' '}
            <Link href="/">朝刊</Link>
            {' '}をどうぞ。
          </p>
        </section>

        {/* ── ログイン済み: 毎朝ダイジェスト購読プロンプト（未購読のみ・一度きり・同意ベース） ── */}
        {digestPromptOpen && sessionUserId && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
            className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 pr-10"
          >
            <button onClick={dismissDigestPrompt} aria-label="閉じる"
              className="absolute top-2.5 right-2.5 p-1 rounded-md hover:bg-white/10 text-slate-500 hover:text-white transition-colors">
              <X size={14} />
            </button>
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-9 h-9 rounded-lg bg-indigo-500/15 flex items-center justify-center text-indigo-300">
                <Mail size={17} />
              </div>
              <div className="min-w-0">
                <p className="text-sm sm:text-base text-slate-100 leading-relaxed">
                  <span className="font-bold text-white">毎朝の朝刊をメールで受け取りますか？</span>
                  <span className="text-slate-400"> 今朝の号がそのまま届きます。いつでも停止できます。</span>
                </p>
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  <button onClick={subscribeDigest}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--text-main)] text-[var(--bg-color)] text-xs font-bold hover:opacity-80 transition-opacity">
                    <Mail size={13} /> 受け取る
                  </button>
                  <button onClick={dismissDigestPrompt}
                    className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors">
                    あとで
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* 朝刊・週次・月次のカードはここには置かない（2026-09-11）。
            本紙はトップ `/` にあり、同じものを一覧の上にも置くと「どちらが本体か」が読者に分からなくなる。
            累計件数などの実績ストリップも外した＝作り手の数字であって、記事を探しに来た人の役に立たない。 */}

        {/* ── 後で読む（ログイン時のみ） ──
            ここには以前「あなた向け」＝行動ベース推薦と読書DNAのペルソナを置いていたが、
            2026-09-12に撤去した。読了イベントはお気に入り/後で読む/既読トグルの3操作でしか
            書き込まれず、普通に読んでいる人の中身がいつまでも変わらない＝動いていない機能だった。
            残したのは「見逃しを後から拾える」入口だけ。 */}
        {sessionUserId && readLater.length > 0 && (
          <section className={s.listSection}>
            <button onClick={() => setSavedOpen(true)} className={s.savedRow}>
              <span className={s.savedLabel}>
                <Bookmark size={14} /> 後で読む
                <span className={s.savedCount}>{readLater.length}</span>
              </span>
              <span className={s.savedMore}>全部見る <ArrowRight size={12} /></span>
            </button>
          </section>
        )}

        {/* 「今日の注目」は撤去した（2026-09-11）。重要記事を選んで前に出すのは朝刊の仕事で、
            同じ選別を一覧でもう一度やると、朝刊とは違う5本が並んで「どちらが本紙の選別か」が濁る。 */}

        {/* ── 最新の記事 ── */}
        <section className={s.listSection}>
          <h2 className={s.listSectionTitle}>最新の記事</h2>
          {isLoading ? (
            <div className={s.river}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-32 border-b border-[var(--border-glass)] animate-pulse" />
              ))}
            </div>
          ) : feed.length > 0 ? (
            <>
              <div className={s.river}>
                {feed.map(item => (
                  <PubCard key={item.id} item={item} />
                ))}
              </div>
              {/* 第2波（フィード残りの後追い）実行中は先頭件の下にスケルトンを出し、上から順に埋まる様子を示す */}
              {belowFoldPending ? (
                <div aria-hidden>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-32 border-b border-[var(--border-glass)] animate-pulse" />
                  ))}
                </div>
              ) : hasMore ? (
                <div className="flex justify-center pt-9">
                  <button onClick={loadMore} disabled={loadingMore}
                    className="px-6 py-3 rounded-full border border-[var(--border-glass)] text-[var(--text-main)] hover:bg-[var(--accent-soft)] text-sm font-bold transition-colors disabled:opacity-40">
                    {loadingMore ? '読み込み中…' : 'もっと読む'}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-slate-500">記事がまだありません。</p>
          )}
        </section>

        {/* ── 未ログイン向け末尾CTA（控えめ） ── */}
        {!sessionUserId && (
          <section className={`${s.listSection} rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-7 text-center space-y-3`}>
            <p className="text-base sm:text-lg text-white font-bold">気になった1本を、あとで拾う</p>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-md mx-auto">
              ログインすると <span className="text-sky-300">お気に入り</span> / <span className="text-sky-300">後で読む</span> / <span className="text-sky-300">毎朝のメール</span> が使えます。閲覧は無料でずっと続けられます。
            </p>
            <div className="pt-1">
              <button onClick={() => signIn('google')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[var(--text-main)] text-[var(--bg-color)] text-sm font-bold hover:opacity-80 transition-opacity">
                <LogIn size={13} /> Googleでログイン
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              続行＝Googleアカウントでログイン · <Link href="/privacy" className="underline underline-offset-2 hover:text-slate-300 transition-colors">プライバシー</Link>
            </p>
          </section>
        )}

        <footer className={`${s.listSection} pt-8 border-t border-white/5`}>
          {/* グループ化したフッター（サービス / 規約 / フィードバック）。横一列の窮屈さを解消 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-7 max-w-2xl mx-auto">
            <div>
              <p className="text-[11px] font-bold text-slate-300 mb-2.5 font-outfit">サービス</p>
              <ul className="space-y-1.5 text-[12px] text-slate-500">
                <li><Link href="/about" scroll={false} className="hover:text-slate-300 transition-colors">このサービスについて</Link></li>
                <li><Link href="/topic" className="hover:text-slate-300 transition-colors">トピック一覧</Link></li>
                <li><Link href="/changelog" scroll={false} className="hover:text-slate-300 transition-colors">更新履歴</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-300 mb-2.5 font-outfit">規約・プライバシー</p>
              <ul className="space-y-1.5 text-[12px] text-slate-500">
                <li><Link href="/privacy" scroll={false} className="hover:text-slate-300 transition-colors">プライバシーポリシー</Link></li>
                <li><Link href="/terms" scroll={false} className="hover:text-slate-300 transition-colors">利用規約</Link></li>
              </ul>
            </div>
            {feedbackAvailable && (
              <div>
                <p className="text-[11px] font-bold text-slate-300 mb-2.5 font-outfit">フィードバック</p>
                <ul className="space-y-1.5 text-[12px] text-slate-500">
                  <li><Link href="/feedback" scroll={false} className="hover:text-slate-300 transition-colors">ご意見・不具合の報告</Link></li>
                </ul>
              </div>
            )}
          </div>
          {/* 最下部バー: ロゴ＋コピーライト */}
          <div className="mt-8 pt-4 border-t border-white/5 max-w-2xl mx-auto flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-slate-500">Cernoval</span>
            </div>
            <p className="font-mono text-[10px] text-slate-700">{SITE_TAGLINE} · © 2026</p>
          </div>
        </footer>
      </main>

      {/* ── モーダル ── */}
      <SavedItemsModal
        open={savedOpen}
        onClose={() => setSavedOpen(false)}
        onOpenArticle={(id) => { setSavedOpen(false); openArticle(id); }}
        onToggleReadLater={handleToggleReadLater}
        onToggleFavorite={handleToggleFavorite}
      />
    </div>
  );
}
