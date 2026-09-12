"use client";

import Link from 'next/link';
import { Star, Bookmark, CheckCircle2, ExternalLink, ListTree, Newspaper } from 'lucide-react';
import type { ArticleDetail } from '@/app/actions';
import { safeHttpUrl } from '@/lib/safeUrl';
import { ShareButtons } from '@/components/ShareButtons';
import { AiBadge } from '@/components/AiBadge';
import { noSummaryReason } from '@/lib/no-summary';
import { SITE_URL } from '@/lib/site';
import { CATEGORY_COLORS } from '@/lib/category-colors';
import { ObservedFacts } from '@/components/public/ObservedFacts';
import s from '@/styles/brand.module.css';

// 記事本文の表示部。モーダル(ArticleDetailModal)と全画面ページ(/articles/[id])の両方で共用する。
// 状態(fav/rl/read)とトグル操作は親が供給する（モーダルは楽観patch、ページはServer Action）。
//
// 2026-09-12: 箱（角丸カード＋枠線のボタン）をやめ、朝刊・記事一覧と同じ「罫で仕切る組み」に揃えた。
// 記事だけ別のデザイン言語だと、同じサイトの中で読み口が切り替わってしまう。

interface Props {
  article: ArticleDetail;
  fav: boolean;
  rl: boolean;
  read: boolean;
  onToggleFav: () => void;
  onToggleRl: () => void;
  onToggleRead: () => void;
  /** 「一覧で表示」ボタン。渡されたときだけ表示（モーダル用。全画面ページでは不要）。 */
  onShowInList?: () => void;
}

export function ArticleDetailContent({
  article, fav, rl, read, onToggleFav, onToggleRl, onToggleRead, onShowInList,
}: Props) {
  const color = CATEGORY_COLORS[article.category ?? ''] ?? 'var(--cat-other)';
  const safeUrl = safeHttpUrl(article.url); // javascript:/data:等を弾いてから href に使う
  const reason = article.summary ? null : noSummaryReason(article);

  return (
    <article className={s.artShell}>
      <header className={s.artHead}>
        <div className={s.artTop}>
          {article.category
            ? <Link href={`/category/${encodeURIComponent(article.category)}`} scroll={false}
                className={s.artCat} style={{ color }}>{article.category}</Link>
            : <span className={s.artCat} style={{ color }}>OTHER</span>}
          {/* 決定④: 重要度★は出さない。数えただけの事実だけを添える（src/components/public/ObservedFacts.tsx） */}
          <ObservedFacts item={article} className={s.artFacts} />
          {(article.storyCount ?? 1) > 1 && (article.storyOutlets?.length ?? 0) > 0 && (
            <span className={s.artFlag}>
              <Newspaper size={11} />{article.storyOutlets!.slice(0, 3).join('・')}が報じた
            </span>
          )}
          {read && <span className={s.artFacts}>既読</span>}
        </div>

        <h1 className={s.artTitle}>{article.titleJa || article.title || '無題'}</h1>
        {article.titleJa && article.title && article.titleJa !== article.title && (
          <p className={s.artTitleOrig}>{article.title}</p>
        )}
        <div className={s.artMeta}>
          {article.sourceValue && <span>{article.sourceValue}</span>}
          {article.publishedAt && <span>{new Date(article.publishedAt).toLocaleDateString('ja-JP')}</span>}
        </div>
      </header>

      {/* 操作 */}
      <div className={s.artActions}>
        <button onClick={onToggleFav} className={`${s.artBtn} ${fav ? s.artBtnOn : ''}`}>
          <Star size={14} className={fav ? 'fill-current' : ''} /> お気に入り
        </button>
        <button onClick={onToggleRl} className={`${s.artBtn} ${rl ? s.artBtnOn : ''}`}>
          <Bookmark size={14} className={rl ? 'fill-current' : ''} /> 後で読む
        </button>
        <button onClick={onToggleRead} className={`${s.artBtn} ${read ? s.artBtnOn : ''}`}>
          <CheckCircle2 size={14} /> {read ? '既読' : '既読にする'}
        </button>
        {onShowInList && (
          <button onClick={onShowInList} className={s.artBtn}>
            <ListTree size={14} /> 一覧で表示
          </button>
        )}
        {safeUrl && (
          <a href={safeUrl} target="_blank" rel="noopener noreferrer"
            onClick={() => { if (!read) onToggleRead(); }}
            className={`${s.artBtn} ${s.artLink}`}>
            <ExternalLink size={14} /> 元記事を読む
          </a>
        )}
      </div>

      {/* サマリー（AIによる要約）。無い場合は空欄にせず理由を書く（src/lib/no-summary.ts）。
          クリックして開いたのに何も無い状態は、読者には不具合にしか見えない。 */}
      {article.summary ? (
        <section className={s.artSection}>
          <div className={s.artBadge}><AiBadge label="AI要約" /></div>
          <p className={s.artBody}>{article.summary}</p>
        </section>
      ) : reason ? (
        <section className={s.artSection}>
          <p className={s.artNote}>{reason.text}</p>
        </section>
      ) : null}

      {/* 要点（AIが書き起こした3〜5行）＋なぜ重要か。
          元記事本文は著作権上そのまま出せない(第三条)ため、本文の転載ではなく要約として提示する。 */}
      {article.keyPoints && article.keyPoints.length > 0 && (
        <section className={s.artSection}>
          <div className={s.artBadge}><AiBadge label="AI要点" /></div>
          <ul className={s.artPoints}>
            {article.keyPoints.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
          {article.whyMatters && (
            <div className={s.artWhy}>
              <p className={s.artLabel}>なぜ重要か</p>
              <p className={s.artBody}>{article.whyMatters}</p>
            </div>
          )}
        </section>
      )}

      {/* 抽出本文(rawContent)は著作権上、公開UIでは一切表示しない(第三条・オーナーにも出さない)。
          本文は内部の情報解析専用。ユーザー向けは要約＋AI要点＋元記事リンクに限定する。 */}

      {article.tags && article.tags.length > 0 && (
        <div className={s.artTags}>
          {article.tags.slice(0, 6).map(t => (
            <Link key={t} href={`/tag/${encodeURIComponent(t)}`} scroll={false}>#{t}</Link>
          ))}
        </div>
      )}

      <div className={s.artFoot}>
        <ShareButtons url={`${SITE_URL}/articles/${article.id}`} title={article.titleJa || article.title || '無題'} />
      </div>
    </article>
  );
}
