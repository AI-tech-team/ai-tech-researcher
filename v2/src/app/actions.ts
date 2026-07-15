'use server';

import { db, client } from '@/db';
import { sources, collectedData, reports, adoptionLogs, claims, userTopicWeights, benchmarks, relations, entities, readingEvents, userArticleState, userProfiles, users, chatMemory } from '@/db/schema';
import { desc, asc, eq, count, gte, sql, like, or, and, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { isOwner } from '@/lib/owner';
import { memRateLimit } from '@/lib/ratelimit';
import { google } from '@ai-sdk/google';
import { embedMany } from 'ai';
import { cached } from '@/lib/cache';
import { vocabCandidates, segmentQuery, toMatchExpr } from '@/lib/search-tokens';
import type { CollectedItem, KnowledgeStats, ReadingProfile, Report } from '@/types';

// 読書DNA: カテゴリ→4軸の寄与（depth:0理論↔100実装 / view:0研究者↔50エンジニア↔100ビジネス / recency:0長期↔100近未来）
const CAT_AXIS: Record<string, { depth: number; view: number; recency: number }> = {
  '研究/論文':            { depth: 5,  view: 5,  recency: 25 },
  'LLM推論':              { depth: 70, view: 45, recency: 60 },
  'エージェント':          { depth: 75, view: 50, recency: 65 },
  'ツール/フレームワーク': { depth: 95, view: 45, recency: 60 },
  'ハードウェア':          { depth: 55, view: 50, recency: 55 },
  'ビジネス応用':          { depth: 40, view: 95, recency: 75 },
  'その他':               { depth: 50, view: 50, recency: 50 },
};

// created_at等はSQLiteのCURRENT_TIMESTAMP（"YYYY-MM-DD HH:MM:SS" 空白区切り）で格納される。
// 比較しきい値もこの形式に揃える（ISOの"T"/"Z"だと文字列比較で境界1日分ずれるため）。
function sqlTs(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// ─── 共通クエリヘルパー ───────────────────────────────────────────

function parseCollectedRows(rows: any[]): CollectedItem[] {
  return rows.map(row => ({
    ...row,
    tags: row.tags
      ? (() => { try { return JSON.parse(row.tags); } catch { return null; } })()
      : null,
  }));
}

const COLLECTED_SELECT = {
  id: collectedData.id,
  title: collectedData.title,
  titleJa: collectedData.titleJa,
  url: collectedData.url,
  summary: collectedData.summary,
  category: collectedData.category,
  isFavorited: collectedData.isFavorited,
  isReadLater: collectedData.isReadLater,
  isRead: collectedData.isRead,
  importanceScore: collectedData.importanceScore,
  normalizedImportanceScore: collectedData.normalizedImportanceScore,
  tags: collectedData.tags,
  publishedAt: collectedData.publishedAt,
  createdAt: collectedData.createdAt,
  sourceValue: sources.value,
  sourceType: sources.type,
  storyId: collectedData.storyId,
  storyCount: collectedData.storyCount,
};

// v6: ログイン中ユーザーの users.id を取得（未ログインは undefined）
async function currentUserId(): Promise<number | undefined> {
  try {
    const session = await auth();
    return (session?.user as { id?: number } | undefined)?.id;
  } catch { return undefined; }
}

// v6: 取得済み記事リストに、ログインユーザーのお気に入り/後で読む/既読を上書き
async function overlayUserState<T extends { id: number; isFavorited?: number | null; isReadLater?: number | null; isRead?: number | null }>(
  items: T[], userId: number | undefined,
): Promise<T[]> {
  // 未ログインまたは空なら全て0（グローバル列は使わない）
  for (const it of items) { it.isFavorited = 0; it.isReadLater = 0; it.isRead = 0; }
  if (!userId || items.length === 0) return items;
  const ids = items.map(i => i.id);
  const states = await db.select({
    articleId: userArticleState.articleId,
    isFavorited: userArticleState.isFavorited,
    isReadLater: userArticleState.isReadLater,
    isRead: userArticleState.isRead,
  }).from(userArticleState)
    .where(and(eq(userArticleState.userId, userId), inArray(userArticleState.articleId, ids)));
  const map = new Map(states.map(s => [s.articleId, s]));
  for (const it of items) {
    const s = map.get(it.id);
    if (s) { it.isFavorited = s.isFavorited ?? 0; it.isReadLater = s.isReadLater ?? 0; it.isRead = s.isRead ?? 0; }
  }
  return items;
}

// 読書DNA: 記事行動を記録（4軸プロファイルの元データ）。userIdでユーザー別に分離
async function logReadingEvent(articleId: number, action: string, weight: number, category: string | null, userId?: number) {
  try {
    await db.insert(readingEvents).values({ articleId, action, weight, category, userId: userId ?? null });
  } catch (e) {
    console.error('Failed to log reading event:', e);
  }
}

// タイトルとカテゴリから固有技術キーワードを抽出（トピック重み更新用）
function extractKeywords(title: string | null, category: string | null): string[] {
  const kws: string[] = [];
  if (category) kws.push(category);
  // 英語の固有名詞・技術用語（先頭大文字 or 全大文字、3文字以上）
  const terms = (title ?? '').match(/[A-Z][a-zA-Z0-9-]{2,}|[A-Z]{3,}/g) ?? [];
  return [...new Set([...kws, ...terms.slice(0, 4)])];
}

// ─── データ取得 ───────────────────────────────────────────────────

// 公開してよいレポート種別は daily/weekly/monthly のみ（ホワイトリスト/fail-closed）。
// briefing/learning_recap/cross_insight/corpus_health 等の内部レポートは新種別が増えても既定で非公開。
// （"use server" ファイルは async 関数しか export できないため定数化はせずクエリ内に直書きする）
// limit/contentChars: 旧実装は全レポートを本文込みで返しており、ホームSSRのペイロードが
// レポート蓄積に比例して肥大（TTFB/FCP悪化の主因）。UIが使うのはリード文(最大260字)なので
// 既定は直近40件×本文800字に絞る。全文が要る呼び出し(feed.xml)は contentChars=0 を指定。
export async function getReportsData(limit = 40, contentChars = 800) {
  try {
    // 公開Server Actionは引数もクライアント供給になり得るため上限をサーバ側で強制（行動原則6）
    const lim = Math.min(Math.max(limit, 1), 1000);
    const chars = Math.min(Math.max(contentChars, 0), 100_000);
    // 公開対象(daily/weekly/monthly)のみ。内部レポートはホワイトリストから外れるので自動的に除外。
    // 全ユーザー共通かつ更新頻度が低いのでインスタンス内60秒キャッシュ（毎アクセスのTurso読みを削減）。
    return await cached(`reportsData:${lim}:${chars}`, 60_000, () => db.select({
      id: reports.id,
      type: reports.type,
      reportDate: reports.reportDate,
      createdAt: reports.createdAt,
      content: chars > 0 ? sql<string | null>`substr(${reports.content}, 1, ${chars})` : reports.content,
    }).from(reports)
      .where(sql`${reports.type} IN ('daily', 'weekly', 'monthly')`)
      .orderBy(desc(reports.createdAt))
      .limit(lim));
  } catch (error) {
    console.error("Failed to fetch reports:", error);
    return [];
  }
}

export async function getSourcesData() {
  // ソース一覧(フィードURL/スコア/状態)は運用情報。公開UI(PublicApp)はsrcsを使わないため
  // オーナー限定にして匿名へのキュレーション戦略の露出を防ぐ（getCoreData経由でも非オーナーは[]）。
  if (!(await isOwner())) return [];
  try {
    return await db.select().from(sources).orderBy(desc(sources.score));
  } catch (error) {
    console.error("Failed to fetch sources:", error);
    return [];
  }
}

function urlDomain(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

export async function getCollectedDataList(limit = 60, offset = 0): Promise<CollectedItem[]> {
  try {
    const userId = await currentUserId();
    const lim = Math.min(Math.max(limit, 1), 200);
    const off = Math.max(offset, 0);

    // 全ユーザー共通の「コーパス部分」(記事行＋媒体一覧)はインスタンス内90秒キャッシュし、
    // 毎アクセスでTursoを叩かない(読み取り課金・レイテンシ削減)。ユーザー別状態(お気に入り等)は
    // キャッシュせず、下でコピーしてから上書きする。
    const base = await cached(`corpus:${lim}:${off}`, 90_000, async () => {
      const rows = await db.select(COLLECTED_SELECT)
        .from(collectedData)
        .leftJoin(sources, eq(collectedData.sourceId, sources.id))
        .orderBy(desc(collectedData.createdAt))
        .limit(lim)
        .offset(off);
      const list = parseCollectedRows(rows);

      // 複数媒体が報じたストーリーについて、媒体（ドメイン）一覧を付与（全ユーザー共通データ）
      const multiStoryIds = [...new Set(
        list.filter(i => (i.storyCount ?? 1) > 1 && i.storyId != null).map(i => i.storyId as number)
      )];
      if (multiStoryIds.length > 0) {
        const members = await db.select({
          storyId: collectedData.storyId,
          url: collectedData.url,
          sourceValue: sources.value,
        })
          .from(collectedData)
          .leftJoin(sources, eq(collectedData.sourceId, sources.id))
          .where(inArray(collectedData.storyId, multiStoryIds));

        const outletMap = new Map<number, string[]>();
        for (const m of members) {
          if (m.storyId == null) continue;
          const outlet = urlDomain(m.url) ?? m.sourceValue ?? null;
          if (!outlet) continue;
          const arr = outletMap.get(m.storyId) ?? [];
          if (!arr.includes(outlet)) arr.push(outlet);
          outletMap.set(m.storyId, arr);
        }
        for (const item of list) {
          if (item.storyId != null && outletMap.has(item.storyId)) {
            item.storyOutlets = outletMap.get(item.storyId);
          }
        }
      }
      return list;
    });

    // ⚠️ cachedは共有参照を返すため、overlayUserStateで破壊的に書き換える前に各itemを浅くコピーする
    // （しないと先に開いたユーザーのお気に入り状態がキャッシュに焼き付き、他ユーザーへ漏れる）。
    const items = base.map(i => ({ ...i }));
    await overlayUserState(items, userId);
    return items;
  } catch (error) {
    console.error("Failed to fetch collected data:", error);
    return [];
  }
}

// カテゴリ別の記事一覧（公開URLページ /category/[name] 用）。重要度→新着順。
// 公開SEOページなのでユーザー別状態は載せず、5分キャッシュで読み取り課金を抑える。
export async function getArticlesByCategory(category: string, limit = 40, offset = 0): Promise<CollectedItem[]> {
  try {
    const lim = Math.min(Math.max(limit, 1), 100);
    const off = Math.max(offset, 0);
    return await cached(`bycat:${category}:${lim}:${off}`, 300_000, async () => {
      const rows = await db.select(COLLECTED_SELECT)
        .from(collectedData)
        .leftJoin(sources, eq(collectedData.sourceId, sources.id))
        .where(eq(collectedData.category, category))
        .orderBy(desc(collectedData.importanceScore), desc(collectedData.createdAt))
        .limit(lim).offset(off);
      return parseCollectedRows(rows);
    });
  } catch (error) {
    console.error('getArticlesByCategory failed:', error);
    return [];
  }
}

// タグ別の記事一覧（公開URLページ /tag/[name] 用）。tags は JSON配列文字列なので "tag" の含有で判定。
export async function getArticlesByTag(tag: string, limit = 40, offset = 0): Promise<CollectedItem[]> {
  try {
    const lim = Math.min(Math.max(limit, 1), 100);
    const off = Math.max(offset, 0);
    // %_ はLIKEのワイルドカードなのでエスケープ（タグ名由来の意図しない広域マッチを防ぐ）
    const safe = tag.replace(/[\\%_]/g, (m) => `\\${m}`);
    return await cached(`bytag:${tag}:${lim}:${off}`, 300_000, async () => {
      const rows = await db.select(COLLECTED_SELECT)
        .from(collectedData)
        .leftJoin(sources, eq(collectedData.sourceId, sources.id))
        .where(sql`${collectedData.tags} LIKE ${'%"' + safe + '"%'} ESCAPE '\\'`)
        .orderBy(desc(collectedData.importanceScore), desc(collectedData.createdAt))
        .limit(lim).offset(off);
      return parseCollectedRows(rows);
    });
  } catch (error) {
    console.error('getArticlesByTag failed:', error);
    return [];
  }
}

// レポートの前後ナビ用: 同タイプの隣接レポート(前=古い/次=新しい)をreport_dateで取得。
export async function getAdjacentReports(type: string, reportDate: string): Promise<{ prev: { id: number; reportDate: string } | null; next: { id: number; reportDate: string } | null }> {
  try {
    if (!['daily', 'weekly', 'monthly'].includes(type)) return { prev: null, next: null };
    const [prev] = await db.select({ id: reports.id, reportDate: reports.reportDate })
      .from(reports).where(and(eq(reports.type, type), sql`${reports.reportDate} < ${reportDate}`))
      .orderBy(desc(reports.reportDate)).limit(1);
    const [next] = await db.select({ id: reports.id, reportDate: reports.reportDate })
      .from(reports).where(and(eq(reports.type, type), sql`${reports.reportDate} > ${reportDate}`))
      .orderBy(asc(reports.reportDate)).limit(1);
    return { prev: prev ?? null, next: next ?? null };
  } catch (error) {
    console.error('getAdjacentReports failed:', error);
    return { prev: null, next: null };
  }
}

// sitemap用: 中身が充実したエンティティ名（関係を持つもの＝/topic が noindex にならない）を列挙。
export async function getSitemapTopics(limit = 300): Promise<string[]> {
  try {
    const r = await client.execute(
      `SELECT n FROM (
         SELECT subject_name AS n FROM relations WHERE status != 'stale'
         UNION SELECT object_name AS n FROM relations WHERE status != 'stale'
       ) WHERE n IS NOT NULL AND n != '' LIMIT ${Math.min(Math.max(limit, 1), 1000)}`,
    );
    return r.rows.map((row) => String(row.n)).filter(Boolean);
  } catch (error) {
    console.error('getSitemapTopics failed:', error);
    return [];
  }
}

// 単一記事をID指定で取得（本文rawContent＋要点込み）。リスト読み込み範囲に依存しないジャンプ用。
// key_points/why_matters は詳細でしか使わないので、一覧(COLLECTED_SELECT)には含めない（ペイロード維持）。
export type ArticleDetail = CollectedItem & {
  rawContent?: string | null;
  keyPoints?: string[] | null;
  whyMatters?: string | null;
};
export async function getArticleById(id: number): Promise<ArticleDetail | null> {
  try {
    if (!Number.isFinite(id)) return null;
    const [userId, owner] = await Promise.all([currentUserId(), isOwner()]);
    const rows = await db.select({
      ...COLLECTED_SELECT,
      rawContent: collectedData.rawContent,
      keyPoints: collectedData.keyPoints,
      whyMatters: collectedData.whyMatters,
    })
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(eq(collectedData.id, id))
      .limit(1);
    if (rows.length === 0) return null;
    const items = parseCollectedRows(rows).map(it => {
      const kp = (it as unknown as { keyPoints?: string | null }).keyPoints;
      return {
        ...it,
        keyPoints: kp ? (() => { try { const a = JSON.parse(kp); return Array.isArray(a) ? a : null; } catch { return null; } })() : null,
      };
    }) as ArticleDetail[];
    await overlayUserState(items, userId);
    const item = items[0] ?? null;
    // 著作権・各情報源ToSへの配慮: 元記事から抽出した本文(rawContent)は内部の情報解析用に保持するが、
    // 一般公開では再表示しない(=公衆送信しない)。公開UIは「要約＋元記事リンク＋分析」に限定する
    // (利用規約§5の表明とも一致)。運用者(オーナー)が内部確認する場合のみ本文を返す。
    if (item && !owner) item.rawContent = null;
    return item;
  } catch (error) {
    console.error('getArticleById failed:', error);
    return null;
  }
}

export interface ArticleCounts { total: number; unread: number; favorite: number; readLater: number; }

// セグメントバッジ用の全体件数（ページングで未ロードでも正確）。ユーザー別状態はuser_article_state集計
export async function getArticleCounts(): Promise<ArticleCounts> {
  try {
    const userId = await currentUserId();
    const [tot] = await db.select({ c: count() }).from(collectedData);
    const total = Number(tot?.c ?? 0);
    if (!userId) return { total, unread: total, favorite: 0, readLater: 0 };
    const [fav, rl, rd] = await Promise.all([
      db.select({ c: count() }).from(userArticleState).where(and(eq(userArticleState.userId, userId), eq(userArticleState.isFavorited, 1))),
      db.select({ c: count() }).from(userArticleState).where(and(eq(userArticleState.userId, userId), eq(userArticleState.isReadLater, 1))),
      db.select({ c: count() }).from(userArticleState).where(and(eq(userArticleState.userId, userId), eq(userArticleState.isRead, 1))),
    ]);
    const read = Number(rd[0]?.c ?? 0);
    return { total, unread: Math.max(0, total - read), favorite: Number(fav[0]?.c ?? 0), readLater: Number(rl[0]?.c ?? 0) };
  } catch (error) {
    console.error('getArticleCounts failed:', error);
    return { total: 0, unread: 0, favorite: 0, readLater: 0 };
  }
}

export async function getActivityData() {
  return cached('activityData', 2 * 60_000, async () => {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // JST基準で集計（createdAtはUTC格納。+9hでJST日付に揃え、ラベルもJSTで生成）
      const rows = await db.select({
        date: sql<string>`strftime('%Y-%m-%d', ${collectedData.createdAt}, '+9 hours')`.as('date'),
        cnt: count(),
      })
        .from(collectedData)
        .where(gte(collectedData.createdAt, sqlTs(sevenDaysAgo)))
        .groupBy(sql`strftime('%Y-%m-%d', ${collectedData.createdAt}, '+9 hours')`);

      const result: { name: string; count: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const dateStr = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
        const name = d.toLocaleDateString('ja-JP', { weekday: 'short', timeZone: 'Asia/Tokyo' });
        const found = rows.find(r => r.date === dateStr);
        result.push({ name, count: found ? Number(found.cnt) : 0 });
      }
      return result;
    } catch (error) {
      console.error("Failed to fetch activity data:", error);
      return [];
    }
  });
}

// ─── データ操作 ───────────────────────────────────────────────────

// 行動原則6「フロントは信用しない」: 現在状態はクライアントに申告させずDBから読んで反転する。
// （旧実装はクライアント申告の反転だったため、同じ値の連投で情報源スコア/興味学習を無限に加算できた）
// 副次効果(スコア/学習)はON/OFFで対称にし、トグル往復で正味0＝連打しても積み上がらない。
export async function toggleFavorite(id: number) {
  try {
    if (!Number.isFinite(id)) return { success: false };
    const userId = await currentUserId();
    if (!userId) return { success: false, needLogin: true };
    if (!memRateLimit('uwrite', userId, 300, 60_000)) return { success: false, message: '操作が多すぎます。少し待ってください' };
    const [cur] = await db.select({ v: userArticleState.isFavorited }).from(userArticleState)
      .where(and(eq(userArticleState.userId, userId), eq(userArticleState.articleId, id))).limit(1);
    const newValue = (cur?.v ?? 0) === 1 ? 0 : 1;
    // 核心: お気に入りフラグの保存。これが成功すればユーザー操作は「成功」とする
    await db.insert(userArticleState)
      .values({ userId, articleId: id, isFavorited: newValue })
      .onConflictDoUpdate({
        target: [userArticleState.userId, userArticleState.articleId],
        set: { isFavorited: newValue, updatedAt: new Date().toISOString() },
      });
    // 副次処理（情報源スコア・興味学習・行動ログ）は分析用。ここで失敗しても保存は成功扱いにする。
    // ※全体に例外を伝播させると、保存できているのに「失敗」表示になり誤解を生む（誤エラーの原因だった）
    try {
      const [item] = await db.select({
        sourceId: collectedData.sourceId,
        title: collectedData.title,
        category: collectedData.category,
      }).from(collectedData).where(eq(collectedData.id, id)).limit(1);
      if (item?.sourceId) {
        await db.insert(adoptionLogs).values({ sourceId: item.sourceId, isAdopted: newValue });
        const delta = newValue === 1 ? 2.0 : -2.0;
        await db.update(sources)
          .set({ score: sql`MAX(0.0, COALESCE(${sources.score}, 0.0) + ${delta})` })
          .where(eq(sources.id, item.sourceId));
      }
      // お気に入り = 強いシグナル。解除時は逆符号で打ち消す（往復での積み上げ防止）
      await logReadingEvent(id, newValue === 1 ? 'favorite' : 'unfavorite', newValue === 1 ? 3 : -3, item?.category ?? null, userId);
      const kws = extractKeywords(item?.title ?? null, item?.category ?? null);
      const kwDelta = newValue === 1 ? 0.3 : -0.3;
      const now = new Date().toISOString();
      for (const kw of kws) {
        await db.insert(userTopicWeights)
          .values({ userId, keyword: kw, weight: Math.max(0, kwDelta), updatedAt: now })
          .onConflictDoUpdate({
            target: [userTopicWeights.userId, userTopicWeights.keyword],
            set: { weight: sql`MAX(0.0, ${userTopicWeights.weight} + ${kwDelta})`, updatedAt: now },
          });
      }
    } catch (sideErr) {
      console.warn('[favorite] 副次処理をスキップ（お気に入り自体は保存済み）:', sideErr instanceof Error ? sideErr.message : sideErr);
    }
    revalidatePath('/');
    return { success: true, value: newValue === 1 };
  } catch (error) {
    console.error("Failed to toggle favorite:", error);
    return { success: false };
  }
}

export async function toggleReadLater(id: number) {
  try {
    if (!Number.isFinite(id)) return { success: false };
    const userId = await currentUserId();
    if (!userId) return { success: false, needLogin: true };
    if (!memRateLimit('uwrite', userId, 300, 60_000)) return { success: false, message: '操作が多すぎます。少し待ってください' };
    const [cur] = await db.select({ v: userArticleState.isReadLater }).from(userArticleState)
      .where(and(eq(userArticleState.userId, userId), eq(userArticleState.articleId, id))).limit(1);
    const newValue = (cur?.v ?? 0) === 1 ? 0 : 1;
    // 核心: 後で読むフラグの保存
    await db.insert(userArticleState)
      .values({ userId, articleId: id, isReadLater: newValue })
      .onConflictDoUpdate({
        target: [userArticleState.userId, userArticleState.articleId],
        set: { isReadLater: newValue, updatedAt: new Date().toISOString() },
      });
    // 行動ログは分析用。失敗しても保存は成功扱い。解除時は逆符号で打ち消す
    try {
      const [item] = await db.select({ category: collectedData.category })
        .from(collectedData).where(eq(collectedData.id, id)).limit(1);
      await logReadingEvent(id, newValue === 1 ? 'readlater' : 'unreadlater', newValue === 1 ? 1 : -1, item?.category ?? null, userId);
    } catch (sideErr) {
      console.warn('[readlater] 副次処理をスキップ（保存は成功済み）:', sideErr instanceof Error ? sideErr.message : sideErr);
    }
    revalidatePath('/');
    return { success: true, value: newValue === 1 };
  } catch (error) {
    console.error("Failed to toggle read later:", error);
    return { success: false };
  }
}

export async function markAsRead(id: number) {
  try {
    if (!Number.isFinite(id)) return { success: false };
    const userId = await currentUserId();
    if (!userId) return { success: false, needLogin: true };
    if (!memRateLimit('uwrite', userId, 300, 60_000)) return { success: false, message: '操作が多すぎます。少し待ってください' };
    const [cur] = await db.select({ v: userArticleState.isRead }).from(userArticleState)
      .where(and(eq(userArticleState.userId, userId), eq(userArticleState.articleId, id))).limit(1);
    const newValue = (cur?.v ?? 0) === 1 ? 0 : 1;
    await db.insert(userArticleState)
      .values({ userId, articleId: id, isRead: newValue })
      .onConflictDoUpdate({
        target: [userArticleState.userId, userArticleState.articleId],
        set: { isRead: newValue, updatedAt: new Date().toISOString() },
      });
    // 副次処理はON/OFFで対称（往復での積み上げ防止）。失敗しても保存は成功扱い
    try {
      const [item] = await db.select({
        sourceId: collectedData.sourceId,
        title: collectedData.title,
        category: collectedData.category,
      }).from(collectedData).where(eq(collectedData.id, id)).limit(1);

      const delta = newValue === 1 ? 0.3 : -0.3;
      if (item?.sourceId) {
        await db.update(sources)
          .set({ score: sql`MAX(0.0, COALESCE(${sources.score}, 0.0) + ${delta})` })
          .where(eq(sources.id, item.sourceId));
      }
      await logReadingEvent(id, newValue === 1 ? 'read' : 'unread', newValue === 1 ? 2 : -2, item?.category ?? null, userId);
      // トピック重み（読了 = 弱いシグナル）
      const kws = extractKeywords(item?.title ?? null, item?.category ?? null);
      const kwDelta = newValue === 1 ? 0.1 : -0.1;
      const now = new Date().toISOString();
      for (const kw of kws) {
        await db.insert(userTopicWeights)
          .values({ userId, keyword: kw, weight: Math.max(0, kwDelta), updatedAt: now })
          .onConflictDoUpdate({
            target: [userTopicWeights.userId, userTopicWeights.keyword],
            set: { weight: sql`MAX(0.0, ${userTopicWeights.weight} + ${kwDelta})`, updatedAt: now },
          });
      }
    } catch (sideErr) {
      console.warn('[read] 副次処理をスキップ（既読自体は保存済み）:', sideErr instanceof Error ? sideErr.message : sideErr);
    }
    return { success: true, value: newValue === 1 };
  } catch (error) {
    console.error("Failed to mark as read:", error);
    return { success: false };
  }
}

// ─── v3知識グラフ ───────────────────────────────────────────────────

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  try {
    const [ent, bench, rel, staleRel] = await Promise.all([
      db.select({ c: count() }).from(entities),
      db.select({ c: count() }).from(benchmarks),
      db.select({ c: count() }).from(relations),
      db.select({ c: count() }).from(relations).where(eq(relations.status, 'stale')),
    ]);
    return {
      entities: Number(ent[0]?.c ?? 0),
      benchmarks: Number(bench[0]?.c ?? 0),
      relations: Number(rel[0]?.c ?? 0),
      staleRelations: Number(staleRel[0]?.c ?? 0),
    };
  } catch (error) {
    console.error('Failed to fetch knowledge stats:', error);
    return { entities: 0, benchmarks: 0, relations: 0, staleRelations: 0 };
  }
}

// ─── v6: ユーザープロフィール ─────────────────────────────────────────
export interface MyProfile {
  email: string | null;
  name: string | null;
  image: string | null;
  memberSince: string | null;
  displayName: string;
  interests: string;
  goals: string;
  emailOptIn: boolean;
  hasProfile: boolean; // プロフィール行が既にあるか（無ければ購読トグルを既定ONで見せる）
}

export async function getMyProfile(): Promise<MyProfile | null> {
  try {
    const userId = await currentUserId();
    if (!userId) return null;
    const [u] = await db.select({ email: users.email, name: users.name, image: users.image, createdAt: users.createdAt })
      .from(users).where(eq(users.id, userId)).limit(1);
    const [p] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    return {
      email: u?.email ?? null,
      name: u?.name ?? null,
      image: u?.image ?? null,
      memberSince: u?.createdAt ?? null,
      displayName: p?.displayName ?? '',
      interests: p?.interests ?? '',
      goals: p?.goals ?? '',
      emailOptIn: !!p?.emailOptIn,
      hasProfile: !!p,
    };
  } catch (error) {
    console.error('getMyProfile failed:', error);
    return null;
  }
}

export async function updateMyProfile(data: { displayName: string; interests: string; goals: string; emailOptIn: boolean }) {
  try {
    const userId = await currentUserId();
    if (!userId) return { success: false };
    if (!memRateLimit('profile', userId, 30, 60_000)) return { success: false, message: '更新が多すぎます。少し待ってください' };
    const now = new Date().toISOString();
    const vals = {
      displayName: (data.displayName ?? '').slice(0, 80),
      interests: (data.interests ?? '').slice(0, 500),
      goals: (data.goals ?? '').slice(0, 500),
      emailOptIn: data.emailOptIn ? 1 : 0,
      updatedAt: now,
    };
    await db.insert(userProfiles)
      .values({ userId, ...vals })
      .onConflictDoUpdate({ target: userProfiles.userId, set: vals });
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('updateMyProfile failed:', error);
    return { success: false };
  }
}

// ログイン後の購読プロンプト用：他のプロフィール項目を壊さず email_opt_in だけ 1 にする
export async function subscribeEmailDigest() {
  try {
    const userId = await currentUserId();
    if (!userId) return { success: false };
    if (!memRateLimit('profile', userId, 30, 60_000)) return { success: false };
    const now = new Date().toISOString();
    await db.insert(userProfiles)
      .values({ userId, emailOptIn: 1, updatedAt: now })
      .onConflictDoUpdate({ target: userProfiles.userId, set: { emailOptIn: 1, updatedAt: now } });
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('subscribeEmailDigest failed:', error);
    return { success: false };
  }
}

// v6: 退会（アカウントとユーザー個人データの削除）。個情法/GDPRの消去対応。
// 共有コーパス(記事/知識グラフ)は残し、ユーザーに紐づく個人データのみ削除する。
// セッションはJWTのため、削除後はクライアント側で signOut() すること。
export async function deleteMyAccount(): Promise<{ success: boolean; needLogin?: boolean; message?: string }> {
  try {
    const userId = await currentUserId();
    if (!userId) return { success: false, needLogin: true };
    if (!memRateLimit('account', userId, 5, 60_000)) return { success: false, message: '操作が多すぎます。少し待ってください' };
    // 依存テーブル → users の順で、このユーザーの個人データを全削除する。
    await db.delete(chatMemory).where(eq(chatMemory.userId, userId));
    await db.delete(userArticleState).where(eq(userArticleState.userId, userId));
    await db.delete(readingEvents).where(eq(readingEvents.userId, userId));
    await db.delete(userTopicWeights).where(eq(userTopicWeights.userId, userId));
    await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    return { success: true };
  } catch (error) {
    console.error('deleteMyAccount failed:', error);
    return { success: false, message: '退会処理に失敗しました。時間をおいて再試行するか、お問い合わせください。' };
  }
}

// ─── v5: 生きた知識ページ（エンティティ単位の統合ビュー）────────────────

export interface EntityPage {
  name: string;
  type: string | null;
  benchmarks: { benchmark: string; score: number; unit: string | null; date: string | null }[];
  relations: { dir: 'out' | 'in'; type: string; other: string }[];
  claims: { predicate: string; value: string }[];
  articles: { id: number; title: string; category: string | null; importance: number }[];
}

export async function getEntityKnowledgePage(name: string): Promise<EntityPage | null> {
  try {
    const ent = await db.select({ name: entities.canonicalName, type: entities.type })
      .from(entities).where(sql`LOWER(${entities.canonicalName}) = ${name.toLowerCase()}`).limit(1);
    const canonical = ent[0]?.name ?? name;
    const type = ent[0]?.type ?? null;

    const [bench, relsOut, relsIn, clm, claimArts, benchArts] = await Promise.all([
      db.select({ benchmark: benchmarks.benchmarkName, score: benchmarks.score, unit: benchmarks.unit, date: benchmarks.recordedDate })
        .from(benchmarks).where(eq(benchmarks.entityName, canonical)).orderBy(desc(benchmarks.recordedDate)).limit(12),
      db.select({ type: relations.relationType, other: relations.objectName })
        .from(relations).where(and(eq(relations.subjectName, canonical), sql`${relations.status} != 'stale'`)).limit(20),
      db.select({ type: relations.relationType, other: relations.subjectName })
        .from(relations).where(and(eq(relations.objectName, canonical), sql`${relations.status} != 'stale'`)).limit(20),
      db.select({ predicate: claims.predicate, value: claims.value })
        .from(claims).where(and(eq(claims.subject, canonical), eq(claims.status, 'active'))).orderBy(desc(claims.validFrom)).limit(8),
      db.select({ aid: claims.articleId }).from(claims).where(eq(claims.subject, canonical)).limit(40),
      db.select({ aid: benchmarks.articleId }).from(benchmarks).where(eq(benchmarks.entityName, canonical)).limit(40),
    ]);

    const ids = [...new Set([...claimArts, ...benchArts].map(r => r.aid).filter((x): x is number => x != null))];
    let articles: EntityPage['articles'] = [];
    if (ids.length > 0) {
      const arts = await db.select({
        id: collectedData.id, title: collectedData.title, titleJa: collectedData.titleJa,
        category: collectedData.category, imp: collectedData.importanceScore,
      }).from(collectedData).where(inArray(collectedData.id, ids)).orderBy(desc(collectedData.importanceScore)).limit(12);
      articles = arts.map(a => ({ id: a.id, title: a.titleJa || a.title || '無題', category: a.category, importance: a.imp ?? 5 }));
    }

    return {
      name: canonical,
      type,
      benchmarks: bench.map(b => ({ benchmark: b.benchmark, score: b.score, unit: b.unit, date: b.date })),
      relations: [
        ...relsOut.map(r => ({ dir: 'out' as const, type: r.type, other: r.other })),
        ...relsIn.map(r => ({ dir: 'in' as const, type: r.type, other: r.other })),
      ],
      claims: clm.map(c => ({ predicate: c.predicate, value: c.value })),
      articles,
    };
  } catch (error) {
    console.error('getEntityKnowledgePage failed:', error);
    return null;
  }
}

export async function getReadingProfile(): Promise<ReadingProfile | null> {
  try {
    const userId = await currentUserId();
    if (!userId) return null;
    const now = Date.now();
    const thirtyAgo = sqlTs(new Date(now - 30 * 24 * 60 * 60 * 1000));
    const sixtyAgo = sqlTs(new Date(now - 60 * 24 * 60 * 60 * 1000));
    const twentyOneAgo = sqlTs(new Date(now - 21 * 24 * 60 * 60 * 1000));

    const events = await db.select({
      category: readingEvents.category,
      weight: readingEvents.weight,
      createdAt: readingEvents.createdAt,
    }).from(readingEvents).where(eq(readingEvents.userId, userId)).orderBy(desc(readingEvents.createdAt)).limit(1000);

    if (events.length === 0) return null;

    // 重み付き4軸の集計
    let wSum = 0, depthSum = 0, viewSum = 0, recencySum = 0;
    const catCount = new Map<string, number>();
    const last30 = new Map<string, number>();
    const prior30 = new Map<string, number>();
    const recentCats = new Set<string>();

    for (const e of events) {
      const cat = e.category ?? 'その他';
      const w = e.weight ?? 1;
      const ax = CAT_AXIS[cat] ?? CAT_AXIS['その他'];
      wSum += w;
      depthSum += ax.depth * w;
      viewSum += ax.view * w;
      recencySum += ax.recency * w;
      catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
      const ts = e.createdAt ?? '';
      if (ts >= thirtyAgo) { last30.set(cat, (last30.get(cat) ?? 0) + 1); }
      else if (ts >= sixtyAgo) { prior30.set(cat, (prior30.get(cat) ?? 0) + 1); }
      if (ts >= twentyOneAgo) recentCats.add(cat);
    }

    const depth = wSum ? Math.round(depthSum / wSum) : 50;
    const view = wSum ? Math.round(viewSum / wSum) : 50;
    const recency = wSum ? Math.round(recencySum / wSum) : 50;

    // 広さ: カテゴリ分布のエントロピーを正規化（0=特化, 100=広範）
    const counts = [...catCount.values()];
    const total = counts.reduce((a, b) => a + b, 0);
    let entropy = 0;
    for (const c of counts) { const p = c / total; entropy -= p * Math.log2(p); }
    const maxEntropy = Math.log2(Math.max(2, Object.keys(CAT_AXIS).length));
    const breadth = Math.round((entropy / maxEntropy) * 100);

    const radar = [
      { axis: '深さ',  leftLabel: '理論派',   rightLabel: '実装派',     value: depth },
      { axis: '視点',  leftLabel: '研究者',   rightLabel: 'ビジネス',   value: view },
      { axis: '広さ',  leftLabel: '専門特化', rightLabel: '広範収集',   value: breadth },
      { axis: '時制',  leftLabel: '長期志向', rightLabel: '近未来志向', value: recency },
    ];

    const categoryDistribution = [...catCount.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    // 関心シフト（直近30日 vs その前30日）
    const shiftCats = new Set([...last30.keys(), ...prior30.keys()]);
    const recentShift = [...shiftCats]
      .map(category => {
        const delta = (last30.get(category) ?? 0) - (prior30.get(category) ?? 0);
        return { category, delta, direction: (delta >= 0 ? 'up' : 'down') as 'up' | 'down' };
      })
      .filter(s => s.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 4);

    // 最近読んでいない分野（過去に読んだが直近21日engagementなし）
    const neglectedCategories = [...catCount.keys()].filter(c => !recentCats.has(c) && c !== 'その他');

    // ペルソナ（一言）
    const depthWord = depth >= 65 ? '実装重視' : depth <= 35 ? '理論重視' : 'バランス型';
    const viewWord = view >= 70 ? 'ビジネス視点' : view <= 35 ? '研究者視点' : 'エンジニア視点';
    const breadthWord = breadth >= 60 ? '広く収集' : breadth <= 35 ? '専門特化' : '';
    const persona = [depthWord, viewWord, breadthWord].filter(Boolean).join('・');

    return { totalEvents: events.length, radar, categoryDistribution, recentShift, neglectedCategories, persona };
  } catch (error) {
    console.error('Failed to compute reading profile:', error);
    return null;
  }
}

// 公開UIのグローバル検索向け: 無料テキスト検索（LLM不使用・全コーパス対象）。
// 匿名ユーザーも叩くため、埋め込みAPIを使うsemanticSearchと違いコスト/濫用の心配がない。
// created_at は "YYYY-MM-DD HH:MM:SS"(UTC・空白区切り)で入っている。ISOに直さずDate()に渡すと環境依存でずれる。
function ageDays(createdAt: string | null | undefined): number {
  if (!createdAt) return 3650;
  const ms = Date.parse(String(createdAt).replace(' ', 'T') + 'Z');
  if (Number.isNaN(ms)) return 3650;
  return Math.max(0, (Date.now() - ms) / 86_400_000);
}

// 語彙(search_vocab)は数万語あるので全部は載せない。クエリの部分文字列だけを1回のSQLで照合する。
async function vocabFor(query: string): Promise<Set<string>> {
  const cands = vocabCandidates(query);
  if (!cands.length) return new Set();
  const r = await client.execute({
    sql: `SELECT term FROM search_vocab WHERE term IN (${cands.map(() => '?').join(',')})`,
    args: cands,
  });
  return new Set(r.rows.map(x => String(x.term)));
}

// 語彙で分割 → FTS5(search_fts) → BM25×重要度×新しさ。上位候補のidとスコアを返す。
async function lexicalSearch(q: string, limit = 60): Promise<{ ids: number[]; score: Map<number, number> } | null> {
  const vocab = await vocabFor(q);
  const { tokens, unknown } = segmentQuery(q, vocab);
  // コーパスが知らない内容語を含むクエリ（例:「アボカドの育て方」）は、無関係な記事を並べずに「該当なし」にする
  if (unknown) return null;
  const expr = toMatchExpr(tokens);
  if (!expr) return null;
  const r = await client.execute({
    sql: `SELECT search_fts.rowid AS id, bm25(search_fts) AS bm, cd.importance_score AS imp, cd.created_at AS created
          FROM search_fts JOIN collected_data cd ON cd.id = search_fts.rowid
          WHERE search_fts MATCH ? ORDER BY bm25(search_fts) LIMIT ?`,
    args: [expr, limit],
  });
  const score = new Map<number, number>();
  for (const row of r.rows) {
    const bm = -Number(row.bm); // bm25()は負値（小さいほど良い）。符号を反転して「大きいほど良い」に揃える
    const imp = Number(row.imp ?? 5);
    const rec = 1 / (1 + ageDays(row.created as string) / 30);
    score.set(Number(row.id), bm * (1 + 0.5 * (imp - 5) / 5) * (1 + rec));
  }
  const ids = [...score.keys()].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
  return ids.length ? { ids, score } : null;
}

// 同一ストーリー（同じニュースの別媒体）を1件に畳む。実測: 検索結果の上位10件の15.6%が重複だった。
function dedupeByStory(items: CollectedItem[], limit: number): CollectedItem[] {
  const seen = new Set<number>();
  const out: CollectedItem[] = [];
  for (const it of items) {
    const st = it.storyId;
    if (st != null && seen.has(st)) continue;
    if (st != null) seen.add(st);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

// PRF(擬似適合性フィードバック)で「関連する記事」のidを返す。lexicalSearchの結果を受け取り再計算しない。
// クエリを埋め込まない（種記事の既存ベクトルを平均する）ので Gemini API を1回も呼ばない＝公開経路に課金が出ない。
async function relatedByPRF(lex: { ids: number[] }): Promise<number[]> {
  const seeds = lex.ids.slice(0, 8);
  if (!seeds.length) return [];
  const matched = new Set(lex.ids.slice(0, 25)); // 「一致した記事」と重複させない
  const embRes = await client.execute({
    sql: `SELECT id, vector_extract(embedding) AS e FROM collected_data
          WHERE embedding IS NOT NULL AND id IN (${seeds.map(() => '?').join(',')})`,
    args: seeds,
  });
  const vecs = new Map<number, number[]>();
  for (const r of embRes.rows) {
    try {
      const v = JSON.parse(String(r.e)) as number[];
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      vecs.set(Number(r.id), v.map(x => x / n));
    } catch { /* 壊れたベクトルは無視 */ }
  }
  if (vecs.size === 0) return [];

  let centroid: number[] | null = null;
  let wsum = 0;
  seeds.forEach((id, i) => {
    const v = vecs.get(id);
    if (!v) return;
    const w = 1 / (i + 1); // 順位減衰（上位の記事ほど重心への寄与を大きく）
    wsum += w;
    if (!centroid) centroid = new Array(v.length).fill(0);
    for (let j = 0; j < v.length; j++) centroid[j] += v[j] * w;
  });
  if (!centroid || !wsum) return [];
  const c = (centroid as number[]).map(x => x / wsum);
  const cn = Math.sqrt(c.reduce((s, x) => s + x * x, 0)) || 1;
  const unit = c.map(x => x / cn);

  const nn = await client.execute({
    sql: `SELECT cd.id AS id FROM vector_top_k('collected_embedding_idx', vector32(?), 30) AS v
          JOIN collected_data cd ON cd.rowid = v.id`,
    args: [JSON.stringify(unit)],
  });
  return nn.rows.map(r => Number(r.id)).filter(id => !matched.has(id));
}

/**
 * 公開検索の本体。「一致した記事」(語彙+BM25)と「関連する記事」(PRF意味検索)を一度に返す。
 * 旧実装はクエリを丸ごと `LIKE '%…%'` で照合していたため、「AIの著作権問題」のような複数語クエリが
 * 常に0件になっていた（実測: 正解既知20問で Recall@5=0%、有効クエリの80%が0件）。
 * 形態素解析した索引＋BM25で Recall@5=90% / nDCG@5=87%（2026-07-15計測）。
 * 2レーンは順位融合すると両方の精度が落ちるので必ず別リストで返す（実験18）。
 * lexicalSearch は1回だけ実行し、両レーンで共有する（往復を二重にしない）。
 */
export async function searchAll(query: string): Promise<{ matches: CollectedItem[]; related: CollectedItem[] }> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return { matches: [], related: [] };
  try {
    const userId = await currentUserId();
    const lex = await lexicalSearch(q, 60);
    if (!lex) return { matches: [], related: [] };

    const relatedIds = await relatedByPRF(lex);
    const allIds = [...new Set([...lex.ids, ...relatedIds])];
    const rows = await db.select(COLLECTED_SELECT)
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(inArray(collectedData.id, allIds));
    const byId = new Map(parseCollectedRows(rows).map(it => [it.id, it]));

    const matchItems = lex.ids.map(id => byId.get(id)).filter((x): x is CollectedItem => !!x)
      .sort((a, b) => (lex.score.get(b.id) ?? 0) - (lex.score.get(a.id) ?? 0));
    const matches = dedupeByStory(matchItems, 25);

    const relRank = new Map(relatedIds.map((id, i) => [id, i]));
    const relItems = relatedIds.map(id => byId.get(id)).filter((x): x is CollectedItem => !!x)
      .sort((a, b) => (relRank.get(a.id) ?? 99) - (relRank.get(b.id) ?? 99));
    const related = dedupeByStory(relItems, 6);

    await overlayUserState([...matches, ...related], userId);
    return { matches, related };
  } catch (error) {
    console.error('searchAll failed:', error);
    return { matches: [], related: [] };
  }
}

/** 一致した記事だけ（クライアントのSearchPalette用・軽量）。 */
export async function searchArticles(query: string): Promise<CollectedItem[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  try {
    const userId = await currentUserId();
    const lex = await lexicalSearch(q, 60);
    if (!lex) return [];
    const rows = await db.select(COLLECTED_SELECT)
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(inArray(collectedData.id, lex.ids));
    const items = parseCollectedRows(rows)
      .sort((a, b) => (lex.score.get(b.id) ?? 0) - (lex.score.get(a.id) ?? 0));
    const out = dedupeByStory(items, 25);
    await overlayUserState(out, userId);
    return out;
  } catch (error) {
    console.error('searchArticles failed:', error);
    return [];
  }
}

// 公開UIのディープリンク向け: レポートをIDで単体取得。
// 公開種別(daily/weekly/monthly)のホワイトリストに限定する。
// （getReportsDataと同じホワイトリスト。Server Actionは直接POST可能なため、ここで種別を絞らないと
//   corpus_health等の内部レポートがID総当たりで露出する＝過去に corpus_health が漏れていた。）
export async function getReportById(id: number): Promise<Report | null> {
  try {
    if (!Number.isFinite(id)) return null;
    const [r] = await db.select().from(reports)
      .where(and(
        eq(reports.id, id),
        sql`${reports.type} IN ('daily', 'weekly', 'monthly')`,
      ))
      .limit(1);
    return (r as Report) ?? null;
  } catch (error) {
    console.error('getReportById failed:', error);
    return null;
  }
}

// 公開UIのパーソナライズ向け: ログインユーザーの「お気に入り」記事一覧
export async function getMyFavorites(): Promise<CollectedItem[]> {
  try {
    const userId = await currentUserId();
    if (!userId) return [];
    const rows = await db.select(COLLECTED_SELECT)
      .from(userArticleState)
      .innerJoin(collectedData, eq(userArticleState.articleId, collectedData.id))
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(and(eq(userArticleState.userId, userId), eq(userArticleState.isFavorited, 1)))
      .orderBy(desc(collectedData.createdAt))
      .limit(60);
    const items = parseCollectedRows(rows);
    await overlayUserState(items, userId);
    return items;
  } catch (error) {
    console.error('getMyFavorites failed:', error);
    return [];
  }
}

// 公開UIのパーソナライズ向け: ログインユーザーの「後で読む」記事一覧
export async function getMyReadLater(): Promise<CollectedItem[]> {
  try {
    const userId = await currentUserId();
    if (!userId) return [];
    const rows = await db.select(COLLECTED_SELECT)
      .from(userArticleState)
      .innerJoin(collectedData, eq(userArticleState.articleId, collectedData.id))
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(and(eq(userArticleState.userId, userId), eq(userArticleState.isReadLater, 1)))
      .orderBy(desc(collectedData.createdAt))
      .limit(30);
    const items = parseCollectedRows(rows);
    await overlayUserState(items, userId);
    return items;
  } catch (error) {
    console.error('getMyReadLater failed:', error);
    return [];
  }
}

// 興味/目標テキストの埋め込みベクトル（プロフィール変更時しか変わらないのでキャッシュ＝コスト最小）
async function profileInterestVector(userId: number): Promise<number[] | null> {
  try {
    const [p] = await db.select({ interests: userProfiles.interests, goals: userProfiles.goals })
      .from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    const text = `${p?.interests ?? ''}. ${p?.goals ?? ''}`.trim();
    if (text.replace(/\./g, '').trim().length < 3) return null;
    return await cached(`pvec:${userId}:${text}`, 30 * 60_000, async () => {
      const { embeddings } = await embedMany({
        model: google.embedding('gemini-embedding-001'),
        values: [text.slice(0, 800)],
        providerOptions: { google: { outputDimensionality: 768, taskType: 'RETRIEVAL_QUERY' } },
      });
      return embeddings[0] as number[];
    });
  } catch (e) {
    console.warn('profileInterestVector failed:', e);
    return null;
  }
}

// 読書DNA連動の推薦: エンゲージ記事の重心に近い「未読・未お気に入り」記事
export async function getRecommendations(): Promise<CollectedItem[]> {
  try {
    const userId = await currentUserId();
    if (!userId) return [];
    const ev = await db.select({ articleId: readingEvents.articleId })
      .from(readingEvents).where(eq(readingEvents.userId, userId)).orderBy(desc(readingEvents.createdAt)).limit(40);
    const engagedIds = [...new Set(ev.map(e => e.articleId).filter((v): v is number => v != null))];
    const interestVec = await profileInterestVector(userId);

    // 行動ベースの重心（エンゲージ2件以上で算出）
    let behaviorCentroid: number[] | null = null;
    if (engagedIds.length >= 2) {
      const embRes = await client.execute({
        sql: `SELECT vector_extract(embedding) AS emb FROM collected_data
              WHERE embedding IS NOT NULL AND id IN (${engagedIds.map(() => '?').join(',')})`,
        args: engagedIds,
      });
      const vecs = embRes.rows.map(r => { try { return JSON.parse(r.emb as string) as number[]; } catch { return null; } })
        .filter((v): v is number[] => Array.isArray(v) && v.length > 0);
      if (vecs.length > 0) {
        const dim = vecs[0].length;
        const c = new Array(dim).fill(0);
        for (const v of vecs) for (let i = 0; i < dim; i++) c[i] += v[i];
        for (let i = 0; i < dim; i++) c[i] /= vecs.length;
        behaviorCentroid = c;
      }
    }

    // 行動重心＋興味/目標ベクトルをブレンド（読書DNA × プロフィールのハイブリッド推薦）
    const norm = (v: number[]) => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1; return v.map(x => x / n); };
    let centroid: number[] | null;
    if (behaviorCentroid && interestVec && behaviorCentroid.length === interestVec.length) {
      const b = norm(behaviorCentroid), q = norm(interestVec);
      centroid = b.map((x, i) => 0.6 * x + 0.4 * q[i]);
    } else {
      centroid = behaviorCentroid ?? interestVec ?? null;
    }
    if (!centroid) return [];

    // 鮮度フィルタ: 直近30日の記事のみを候補に。
    // （重心が過去履歴で固定のため、新しさを考慮しないと履歴に似た“昔の記事”ばかり出て更新されなくなる問題への対策）
    // top_kは800と広めに取る（重心が古い話題を指す場合でも、直近30日の候補が痩せて毎回ほぼ同じ8件に
    //   固定されるのを防ぐ＝鮮度フィルタ後のプールを十分確保する）。created_atも取得し再ランクに使う。
    const recentCutoff = sqlTs(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const nn = await client.execute({
      sql: `SELECT cd.id AS id, cd.created_at AS created_at
            FROM vector_top_k('collected_embedding_idx', vector32(?), 800) AS v
            JOIN collected_data cd ON cd.rowid = v.id
            LEFT JOIN user_article_state uas ON uas.article_id = cd.id AND uas.user_id = ?
            WHERE COALESCE(uas.is_read, 0) = 0 AND COALESCE(uas.is_favorited, 0) = 0
              AND cd.created_at >= ?`,
      args: [JSON.stringify(centroid), userId, recentCutoff],
    });
    const engagedSet = new Set(engagedIds);
    // 候補（意味的近さ順）。エンゲージ済みは除外
    const cands = nn.rows
      .map((r, i) => ({ id: Number(r.id), semRank: i, createdAt: String(r.created_at ?? '') }))
      .filter(c => !engagedSet.has(c.id));
    if (cands.length === 0) return [];
    // 新しさ順位（created_at降順＝新しいほど0に近い）
    const byRecency = [...cands].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const recRank = new Map(byRecency.map((c, i) => [c.id, i]));
    // 意味的近さ7 : 新しさ3 でブレンド再ランク（小さいほど上位）。
    // 意味の主役は保ちつつ、新着の関連記事を押し上げて“あなた向け”が日々回転するようにする。
    const recIds = [...cands]
      .sort((a, b) => (0.7 * a.semRank + 0.3 * (recRank.get(a.id) ?? 999))
                    - (0.7 * b.semRank + 0.3 * (recRank.get(b.id) ?? 999)))
      .slice(0, 8)
      .map(c => c.id);
    if (recIds.length === 0) return [];

    const rows = await db.select(COLLECTED_SELECT)
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(inArray(collectedData.id, recIds));
    const order = new Map(recIds.map((id, i) => [id, i]));
    const items = parseCollectedRows(rows).sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
    await overlayUserState(items, userId);
    return items;
  } catch (error) {
    console.error('Failed to fetch recommendations:', error);
    return [];
  }
}

// ─── ページロード最適化: 複数クエリを1HTTP往復で取得 ────────────────────────

// Phase 1: 記事・ソース・レポートなど即表示が必要なコアデータを1往復で取得
export async function getCoreData(articleLimit = 60) {
  const [srcs, data, reportsData, activity, counts] = await Promise.all([
    getSourcesData(),
    getCollectedDataList(articleLimit, 0),
    getReportsData(),
    getActivityData(),
    getArticleCounts(),
  ]);
  return { srcs, data, reportsData, activity, counts };
}
