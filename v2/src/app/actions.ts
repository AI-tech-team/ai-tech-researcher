'use server';

import { db, client } from '@/db';
import { sources, collectedData, reports, adoptionLogs, claims, userTopicWeights, benchmarks, relations, entities, readingEvents, userArticleState, userProfiles, users, chatMemory, pushSubscriptions } from '@/db/schema';
import { desc, asc, eq, count, gte, lte, sql, or, and, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { isOwner } from '@/lib/owner';
// 書込Actionは checkRateLimit（rate_limits 表を共有ストアにする版）を使う。
// memRateLimit はプロセス内Mapなので、Vercelのように毎リクエスト別インスタンスに載る環境では
// 並列に叩くだけでカウンタがリセットされ、実質無制限になる。
import { checkRateLimit } from '@/lib/ratelimit';
import { isAllowedPushEndpoint } from '@/lib/push-endpoint';
import { logError } from '@/lib/logError';
import { z } from 'zod';
import { cached } from '@/lib/cache';
import { vocabCandidates, segmentQuery, toMatchExpr } from '@/lib/search-tokens';
import { isPublishableEntity } from '@/lib/entity-quality';
import { AI_RELEVANT_SQL } from '@/lib/ai-relevance';
import type { CollectedItem, KnowledgeStats, Report } from '@/types';

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
    // SQLite は真偽値を 0/1 で返す。UI 側で truthy 判定を誤らないようここで boolean に寄せる。
    hasBody: row.hasBody == null ? undefined : Boolean(Number(row.hasBody)),
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
  // 要約が無い記事に理由を出すために使う（src/lib/no-summary.ts）。
  // ⚠ rawContent 本体はクライアントに渡さない（第三条）。**有無だけ**を 0/1 で持たせる。
  hasBody: sql<number>`CASE WHEN ${collectedData.rawContent} IS NOT NULL AND LENGTH(${collectedData.rawContent}) > 200 THEN 1 ELSE 0 END`,
  extractError: collectedData.extractError,
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

// 2026-09-12: 行動ログ（reading_events）と興味学習（user_topic_weights）の書き込みをやめた。
// どちらも「あなた向け」推薦と読書DNAの材料で、その2つを撤去した時点で**書くだけで誰も読まない
// 個人の行動データ**になる。集めない（第三条・PII最小化）。既存行は退会時の削除に任せる。

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

/**
 * 紹介ページ(/about)が使う「今朝の朝刊」。
 *
 * 紹介ページの仕事は「3分で読める」を3分かからずに納得させることなので、説明文ではなく
 * **今朝の実物**を置く。そのため最新dailyの本文と、その読了時間、そして選別量（何本から何本に絞ったか）を返す。
 *
 * 選別量の分母は「前回の朝刊以降に集まった記事数」＝そのレポートが実際に選んだ母集団。
 * 「昨日1日の件数」ではない（レポートの対象期間とズレるとページの数字が嘘になる）。
 */
export async function getLandingDigest() {
  try {
    const [latest, prev] = await db.select({
      id: reports.id, reportDate: reports.reportDate, createdAt: reports.createdAt, content: reports.content,
    }).from(reports)
      .where(and(eq(reports.type, 'daily'), sql`length(${reports.content}) > 0`))
      .orderBy(desc(reports.createdAt))
      .limit(2);
    if (!latest?.content) return null;

    // 母集団 = 前回の朝刊から今回の朝刊までに収集された記事。前回が無ければ24時間で代用。
    const until = latest.createdAt ?? '';
    const since = prev?.createdAt
      ?? new Date(new Date(String(until).replace(' ', 'T') + 'Z').getTime() - 86_400_000)
        .toISOString().replace('T', ' ').slice(0, 19);
    const [pool] = await db.select({ n: count() }).from(collectedData)
      .where(and(gte(collectedData.createdAt, since), lte(collectedData.createdAt, until)));

    return {
      id: latest.id,
      reportDate: latest.reportDate,
      content: latest.content,
      collectedFrom: Number(pool?.n ?? 0),
    };
  } catch (error) {
    console.error('Failed to fetch landing digest:', error);
    return null;
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

export async function getCollectedDataList(limit = 60, offset = 0, anonymous = false): Promise<CollectedItem[]> {
  try {
    // anonymous=true はユーザー状態の解決を丸ごと省く（=cookiesを読まない）。SSRの静的化に必要。
    // クライアントから true を渡されても「自分の状態が見えなくなる」だけの権限降格なので安全。
    const userId = anonymous ? undefined : await currentUserId();
    const lim = Math.min(Math.max(limit, 1), 200);
    const off = Math.max(offset, 0);

    // 全ユーザー共通の「コーパス部分」(記事行＋媒体一覧)はインスタンス内90秒キャッシュし、
    // 毎アクセスでTursoを叩かない(読み取り課金・レイテンシ削減)。ユーザー別状態(お気に入り等)は
    // キャッシュせず、下でコピーしてから上書きする。
    const base = await cached(`corpus:${lim}:${off}`, 90_000, async () => {
      const rows = await db.select(COLLECTED_SELECT)
        .from(collectedData)
        .leftJoin(sources, eq(collectedData.sourceId, sources.id))
        // ai_relevance=0（AIと無関係と明示判定）だけを外す。外れても検索と直リンクでは出る
        // ＝回復可能なのでここは掛けてよい。閾値を上げてはいけない理由は lib/ai-relevance.ts。
        .where(AI_RELEVANT_SQL)
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
        .where(and(eq(collectedData.category, category), AI_RELEVANT_SQL))
        .orderBy(desc(collectedData.importanceScore), desc(collectedData.createdAt))
        .limit(lim).offset(off);
      return parseCollectedRows(rows);
    });
  } catch (error) {
    await logError('getArticlesByCategory', error, { alert: true });
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
        .where(and(sql`${collectedData.tags} LIKE ${'%"' + safe + '"%'} ESCAPE '\\'`, AI_RELEVANT_SQL))
        .orderBy(desc(collectedData.importanceScore), desc(collectedData.createdAt))
        .limit(lim).offset(off);
      return parseCollectedRows(rows);
    });
  } catch (error) {
    await logError('getArticlesByTag', error);
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
    await logError('getAdjacentReports', error);
    return { prev: null, next: null };
  }
}

// sitemap用: 中身が充実したエンティティ名（関係を持つもの＝/topic が noindex にならない）を列挙。
export async function getSitemapTopics(limit = 300): Promise<string[]> {
  try {
    // ⚠️ 旧実装は ORDER BY が無く、UNION の結果をそのまま LIMIT していた。その結果 sitemap に
    // 載るのは「アルファベット順の先頭300件」になり、本番実測では `01 AI` 〜 `Coinbase` まで＝
    // `8VC` や `1010 Digital Works` のような無価値ページを出す一方、`OpenAI`/`NVIDIA`/`Gemini`
    // など D以降の主要エンティティが1件もクロールに出ていなかった（2026-09-09 実測）。
    // mention_count 降順にして「言及が多い＝中身のあるエンティティ」から載せる。
    // relations を持つ条件は EXISTS で維持（関係が無い＝空ページ化を避ける）。
    // mention_count>=2 で足切り（実測: m=1 が1,606件中1,309件＝81.5%で、中身は
    // `8VC` `1010 Digital Works` のような一度きりの固有名詞）。フィルタで減る分を見越して多めに取る。
    const lim = Math.min(Math.max(limit, 1), 1000);
    const r = await client.execute(
      `SELECT e.canonical_name AS n, COALESCE(e.mention_count, 0) AS m
         FROM entities e
        WHERE e.canonical_name IS NOT NULL AND e.canonical_name != ''
          AND COALESCE(e.mention_count, 0) >= 2
          AND EXISTS (
            SELECT 1 FROM relations r
             WHERE r.status != 'stale'
               AND (r.subject_name = e.canonical_name OR r.object_name = e.canonical_name)
          )
        ORDER BY e.mention_count DESC
        LIMIT ${lim * 2}`,
    );
    // 一般名詞(AI/LLMs/China/CEO)・文(「既存のLLMスケーリング則」)・文字化けを公開面から除く
    return r.rows
      .map((row) => ({ n: String(row.n), m: Number(row.m ?? 0) }))
      .filter((x) => x.n && isPublishableEntity(x.n, x.m))
      .slice(0, lim)
      .map((x) => x.n);
  } catch (error) {
    await logError('getSitemapTopics', error);
    return [];
  }
}

/**
 * トピック一覧ページ（/topic）用。公開品質を満たすエンティティを言及数の多い順に返す。
 * getSitemapTopics と同じ母集団だが、表示に使う mention_count / type も返す。
 * 匿名データのみ（cookiesを読まない）なので呼び出し側をISR化できる。
 */
export async function getTopicIndex(limit = 200): Promise<{ name: string; mentions: number; type: string | null }[]> {
  try {
    const lim = Math.min(Math.max(limit, 1), 500);
    const r = await client.execute(
      `SELECT e.canonical_name AS n, COALESCE(e.mention_count, 0) AS m, e.type AS t
         FROM entities e
        WHERE e.canonical_name IS NOT NULL AND e.canonical_name != ''
          AND COALESCE(e.mention_count, 0) >= 2
          AND EXISTS (
            SELECT 1 FROM relations r
             WHERE r.status != 'stale'
               AND (r.subject_name = e.canonical_name OR r.object_name = e.canonical_name)
          )
        ORDER BY e.mention_count DESC
        LIMIT ${lim * 2}`,
    );
    return r.rows
      .map((row) => ({ name: String(row.n), mentions: Number(row.m ?? 0), type: row.t ? String(row.t) : null }))
      .filter((x) => x.name && isPublishableEntity(x.name, x.mentions))
      .slice(0, lim);
  } catch (error) {
    await logError('getTopicIndex', error);
    return [];
  }
}

// 単一記事をID指定で取得（要点込み）。リスト読み込み範囲に依存しないジャンプ用。
// key_points/why_matters は詳細でしか使わないので、一覧(COLLECTED_SELECT)には含めない（ペイロード維持）。
// ⚠ rawContent(抽出本文)は絶対にクライアントへ返さない（オーナーにも返さない）。第三条=公衆送信は
//   享受目的で著作権侵害リスク。本文は内部の情報解析(RAG/要点生成)専用でDBには持つが、SELECTにも
//   戻り値にも一切含めない（うっかり露出を型レベルで防ぐため rawContent フィールド自体を廃止）。
export type ArticleDetail = CollectedItem & {
  keyPoints?: string[] | null;
  whyMatters?: string | null;
};
// anonymous=true はユーザー状態の解決を丸ごと省く（=cookiesを読まない）。
// /articles/[id] のSSR静的化に必要で、getCollectedDataList と同じ理由・同じ扱い
// （クライアントから true を渡されても「自分の状態が見えなくなる」だけの権限降格なので安全）。
export async function getArticleById(id: number, anonymous = false): Promise<ArticleDetail | null> {
  try {
    if (!Number.isFinite(id)) return null;
    const userId = anonymous ? undefined : await currentUserId();
    const rows = await db.select({
      ...COLLECTED_SELECT,
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
    return items[0] ?? null;
  } catch (error) {
    await logError('getArticleById', error, { alert: true });
    return null;
  }
}

// 記事1件に対する「自分の」状態だけを引く軽量版。
// /articles/[id] はISR（CDN配信）のためSSRを匿名化した＝HTMLには常に未設定の状態が焼かれる。
// ログイン中の読者にだけ、描画後にここで実状態へ補正する（未ログインなら呼ばれない）。
// これが無いと、お気に入り済みの記事で★が消灯したまま出て、押すと**解除**してしまう。
export async function getMyArticleFlags(id: number): Promise<{ fav: boolean; rl: boolean; read: boolean } | null> {
  try {
    if (!Number.isFinite(id)) return null;
    const userId = await currentUserId();
    if (!userId) return null;
    const [s] = await db.select({
      isFavorited: userArticleState.isFavorited,
      isReadLater: userArticleState.isReadLater,
      isRead: userArticleState.isRead,
    }).from(userArticleState)
      .where(and(eq(userArticleState.userId, userId), eq(userArticleState.articleId, id))).limit(1);
    return { fav: (s?.isFavorited ?? 0) === 1, rl: (s?.isReadLater ?? 0) === 1, read: (s?.isRead ?? 0) === 1 };
  } catch (error) {
    await logError('getMyArticleFlags', error);
    return null;
  }
}

export interface ArticleCounts { total: number; unread: number; favorite: number; readLater: number; }

// セグメントバッジ用の全体件数（ページングで未ロードでも正確）。ユーザー別状態はuser_article_state集計
export async function getArticleCounts(anonymous = false): Promise<ArticleCounts> {
  try {
    const userId = anonymous ? undefined : await currentUserId();
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
    await logError('getArticleCounts', error);
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
    if (!await checkRateLimit('uwrite', userId, 300, 60_000)) return { success: false, message: '操作が多すぎます。少し待ってください' };
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
      const [item] = await db.select({ sourceId: collectedData.sourceId })
        .from(collectedData).where(eq(collectedData.id, id)).limit(1);
      if (item?.sourceId) {
        await db.insert(adoptionLogs).values({ sourceId: item.sourceId, isAdopted: newValue });
        const delta = newValue === 1 ? 2.0 : -2.0;
        await db.update(sources)
          .set({ score: sql`MAX(0.0, COALESCE(${sources.score}, 0.0) + ${delta})` })
          .where(eq(sources.id, item.sourceId));
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
    if (!await checkRateLimit('uwrite', userId, 300, 60_000)) return { success: false, message: '操作が多すぎます。少し待ってください' };
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
    if (!await checkRateLimit('uwrite', userId, 300, 60_000)) return { success: false, message: '操作が多すぎます。少し待ってください' };
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
      const [item] = await db.select({ sourceId: collectedData.sourceId })
        .from(collectedData).where(eq(collectedData.id, id)).limit(1);
      // 既読はソースの質の弱いシグナル。ソーススコアにだけ反映する（個人側には残さない）。
      const delta = newValue === 1 ? 0.3 : -0.3;
      if (item?.sourceId) {
        await db.update(sources)
          .set({ score: sql`MAX(0.0, COALESCE(${sources.score}, 0.0) + ${delta})` })
          .where(eq(sources.id, item.sourceId));
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
    await logError('fetch knowledge stats', error);
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
      emailOptIn: !!p?.emailOptIn,
      hasProfile: !!p,
    };
  } catch (error) {
    await logError('getMyProfile', error);
    return null;
  }
}

// 興味/目標はもう受け取らない（「あなた向け」撤去で使い道が無くなった項目・2026-09-12）。
// 既存行に残っている値は上書きしない＝退会時の削除に任せる。
export async function updateMyProfile(data: { displayName: string; emailOptIn: boolean }) {
  try {
    const userId = await currentUserId();
    if (!userId) return { success: false };
    if (!await checkRateLimit('profile', userId, 30, 60_000)) return { success: false, message: '更新が多すぎます。少し待ってください' };
    const now = new Date().toISOString();
    const vals = {
      displayName: (data.displayName ?? '').slice(0, 80),
      emailOptIn: data.emailOptIn ? 1 : 0,
      updatedAt: now,
    };
    await db.insert(userProfiles)
      .values({ userId, ...vals })
      .onConflictDoUpdate({ target: userProfiles.userId, set: vals });
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    await logError('updateMyProfile', error, { alert: true });
    return { success: false };
  }
}

// ログイン後の購読プロンプト用：他のプロフィール項目を壊さず email_opt_in だけ 1 にする
export async function subscribeEmailDigest() {
  try {
    const userId = await currentUserId();
    if (!userId) return { success: false };
    if (!await checkRateLimit('profile', userId, 30, 60_000)) return { success: false };
    const now = new Date().toISOString();
    await db.insert(userProfiles)
      .values({ userId, emailOptIn: 1, updatedAt: now })
      .onConflictDoUpdate({ target: userProfiles.userId, set: { emailOptIn: 1, updatedAt: now } });
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    await logError('subscribeEmailDigest', error, { alert: true });
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
    if (!await checkRateLimit('account', userId, 5, 60_000)) return { success: false, message: '操作が多すぎます。少し待ってください' };
    // 依存テーブル → users の順で、このユーザーの個人データを全削除する。
    await db.delete(chatMemory).where(eq(chatMemory.userId, userId));
    // push購読は端末固有の識別子と鍵を持つ。消し忘れると退会後も通知が届き続け、
    // プライバシーポリシーの「サーバーから削除します」が事実と食い違う。
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    await db.delete(userArticleState).where(eq(userArticleState.userId, userId));
    await db.delete(readingEvents).where(eq(readingEvents.userId, userId));
    await db.delete(userTopicWeights).where(eq(userTopicWeights.userId, userId));
    await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    return { success: true };
  } catch (error) {
    await logError('deleteMyAccount', error, { alert: true });
    return { success: false, message: '退会処理に失敗しました。時間をおいて再試行するか、お問い合わせください。' };
  }
}

// ─── v5: 生きた知識ページ（エンティティ単位の統合ビュー）────────────────

export interface EntityPage {
  name: string;
  type: string | null;
  /** 言及回数。公開面の品質判定（isPublishableEntity）に使う。未登録エンティティは0 */
  mentionCount: number;
  benchmarks: { benchmark: string; score: number; unit: string | null; date: string | null }[];
  relations: { dir: 'out' | 'in'; type: string; other: string }[];
  claims: { predicate: string; value: string }[];
  /** 決定④: 重要度スコアは読者に見せない。添えるのは数えただけの事実だけ（components/public/ObservedFacts.tsx） */
  articles: { id: number; title: string; category: string | null; storyCount: number | null; publishedAt: string | null }[];
}

export async function getEntityKnowledgePage(name: string): Promise<EntityPage | null> {
  try {
    const ent = await db.select({ id: entities.id, name: entities.canonicalName, type: entities.type, mention: entities.mentionCount })
      .from(entities).where(sql`LOWER(${entities.canonicalName}) = ${name.toLowerCase()}`).limit(1);
    const canonical = ent[0]?.name ?? name;
    const entId = ent[0]?.id ?? null;
    const type = ent[0]?.type ?? null;
    const mentionCount = Number(ent[0]?.mention ?? 0);

    // claims/benchmarks は entity_id で引く。subject/entity_name の完全一致だけで引いていたため、
    // entity `Nvidia` に対し subject が `NVIDIA` のクレーム（SQLiteの = は大小文字を区別する）が
    // ページから丸ごと漏れていた（2026-09-10 本番実測で確認）。名前一致は entity 未登録時のフォールバック。
    const claimMatch = entId != null
      ? or(eq(claims.entityId, entId), eq(claims.subject, canonical))!
      : eq(claims.subject, canonical);
    const benchMatch = entId != null
      ? or(eq(benchmarks.entityId, entId), eq(benchmarks.entityName, canonical))!
      : eq(benchmarks.entityName, canonical);

    const [bench, relsOut, relsIn, clm, claimArts, benchArts] = await Promise.all([
      db.select({ benchmark: benchmarks.benchmarkName, score: benchmarks.score, unit: benchmarks.unit, date: benchmarks.recordedDate })
        .from(benchmarks).where(benchMatch).orderBy(desc(benchmarks.recordedDate)).limit(12),
      db.select({ type: relations.relationType, other: relations.objectName })
        .from(relations).where(and(eq(relations.subjectName, canonical), sql`${relations.status} != 'stale'`)).limit(20),
      db.select({ type: relations.relationType, other: relations.subjectName })
        .from(relations).where(and(eq(relations.objectName, canonical), sql`${relations.status} != 'stale'`)).limit(20),
      db.select({ predicate: claims.predicate, value: claims.value })
        .from(claims).where(and(claimMatch, eq(claims.status, 'active'))).orderBy(desc(claims.validFrom)).limit(8),
      // ⚠ この2本の LIMIT 40 には **ORDER BY を必ず付ける**。付けないとSQLiteは rowid 順＝
      // 挿入の古い順に40行返すので、「関連記事」の候補プールがそのトピックで**最も古い40件**になる。
      // 本番実測(2026-09-13, /topic/OpenAI): claims 107行のうち古い40行 → 記事29件、中央値98日前。
      // ここが「取り上げてるニュースが3か月前」の主因で、下の表示順だけ直しても94日→63日にしかならない
      // （プールごと新しい側に寄せると6日になる）。→ [[pattern-throughput-starvation]] と同じ形で、
      // 上限を書いたら「何が上限からこぼれるか」を必ず見る。
      db.select({ aid: claims.articleId }).from(claims).where(claimMatch).orderBy(desc(claims.id)).limit(40),
      db.select({ aid: benchmarks.articleId }).from(benchmarks).where(benchMatch).orderBy(desc(benchmarks.id)).limit(40),
    ]);

    const ids = [...new Set([...claimArts, ...benchArts].map(r => r.aid).filter((x): x is number => x != null))];
    let articles: EntityPage['articles'] = [];
    if (ids.length > 0) {
      const arts = await db.select({
        id: collectedData.id, title: collectedData.title, titleJa: collectedData.titleJa,
        category: collectedData.category,
        storyCount: collectedData.storyCount, publishedAt: collectedData.publishedAt,
      }).from(collectedData).where(inArray(collectedData.id, ids))
        // ⚠ 並び順に**新しさ**を入れること。importance だけで並べていた頃、このページの関連記事は
        // 本番実測で /topic/OpenAI が中央値94日前・最古115日前だった（2026-09-13）。
        // 収集データ自体は93.4%が当日で健全なのに、表示だけが3か月前を向いていた
        // （本人からの指摘「取り上げてるニュースが3か月前、みたいなのがまあまああった」の正体）。
        // 日付で粗く新しい順に並べ、同じ日の中は重要度で解く（「その日いちばん重要な記事」の並びは保つ）。
        // published_at は本番23,328件すべて ISO UTC（"2026-09-12T15:08:27.000Z"）、created_at は
        // "YYYY-MM-DD HH:MM:SS" のUTC。どちらも先頭10文字が YYYY-MM-DD なので substr で揃えて比較できる。
        // 列はNULL許容なので COALESCE は残す（実測ではNULL 0件だが、スキーマ上入りうる）。
        .orderBy(
          desc(sql`substr(COALESCE(${collectedData.publishedAt}, ${collectedData.createdAt}), 1, 10)`),
          desc(collectedData.importanceScore),
        )
        .limit(12);
      articles = arts.map(a => ({
        id: a.id, title: a.titleJa || a.title || '無題', category: a.category,
        storyCount: a.storyCount, publishedAt: a.publishedAt,
      }));
    }

    return {
      name: canonical,
      type,
      mentionCount,
      benchmarks: bench.map(b => ({ benchmark: b.benchmark, score: b.score, unit: b.unit, date: b.date })),
      relations: [
        ...relsOut.map(r => ({ dir: 'out' as const, type: r.type, other: r.other })),
        ...relsIn.map(r => ({ dir: 'in' as const, type: r.type, other: r.other })),
      ],
      claims: clm.map(c => ({ predicate: c.predicate, value: c.value })),
      articles,
    };
  } catch (error) {
    await logError('getEntityKnowledgePage', error);
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
 * 「関連する記事」(PRF意味検索)だけを返す。検索ページのストリーミング用。
 * 「一致した記事」(語彙+BM25・速い)と別のawait境界にして、一致を先に描画し関連(重いPRF=
 * 埋め込み平均+近傍探索)を Suspense で後追いさせる。以前は両方を1回のawaitで返していたため、
 * 関連が出るまで一致も表示できなかった。
 * 語彙検索(FTS・約数十ms)を種取得のため1回だけ再実行する。クエリは埋め込まない＝Gemini呼び出しゼロ。
 * 2レーンは順位融合すると両方の精度が落ちるので必ず別リストで返す（実験18・2026-07-15）。
 */
export async function searchRelated(query: string): Promise<CollectedItem[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  try {
    const userId = await currentUserId();
    const lex = await lexicalSearch(q, 60);
    if (!lex) return [];
    const relatedIds = await relatedByPRF(lex);
    if (!relatedIds.length) return [];
    const rows = await db.select(COLLECTED_SELECT)
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(inArray(collectedData.id, relatedIds));
    const byId = new Map(parseCollectedRows(rows).map(it => [it.id, it]));
    const relRank = new Map(relatedIds.map((id, i) => [id, i]));
    const relItems = relatedIds.map(id => byId.get(id)).filter((x): x is CollectedItem => !!x)
      .sort((a, b) => (relRank.get(a.id) ?? 99) - (relRank.get(b.id) ?? 99));
    const related = dedupeByStory(relItems, 6);
    await overlayUserState(related, userId);
    return related;
  } catch (error) {
    await logError('searchRelated', error);
    return [];
  }
}

/**
 * 一致した記事だけ。SearchPalette(ドロップダウン)は既定25件で軽量、全画面/search は limit を上げて多く出す。
 * limit を上げるぶん語彙検索の取得数も比例で増やす（畳み込み後に limit 件残るように余裕を持たせる）。
 */
export async function searchArticles(query: string, limit = 25): Promise<CollectedItem[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const cap = Math.min(Math.max(limit, 1), 100);
  try {
    const userId = await currentUserId();
    const lex = await lexicalSearch(q, Math.max(60, cap * 2));
    if (!lex) return [];
    const rows = await db.select(COLLECTED_SELECT)
      .from(collectedData)
      .leftJoin(sources, eq(collectedData.sourceId, sources.id))
      .where(inArray(collectedData.id, lex.ids));
    const items = parseCollectedRows(rows)
      .sort((a, b) => (lex.score.get(b.id) ?? 0) - (lex.score.get(a.id) ?? 0));
    const out = dedupeByStory(items, cap);
    await overlayUserState(out, userId);
    return out;
  } catch (error) {
    await logError('searchArticles', error, { alert: true });
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
    await logError('getReportById', error, { alert: true });
    return null;
  }
}

/**
 * 過去の朝刊（バックナンバー）の見出しだけ。トップと朝刊ページの末尾に出す。
 *
 * 本文を返さない（`getReportsData` は本文の頭800字を返す）。ここで欲しいのは日付だけで、
 * 本文を載せると号の数だけペイロードが線形に増える＝表示に使わないものを配ることになる。
 */
export async function getRecentDigests(limit = 7, excludeId?: number) {
  try {
    const lim = Math.min(Math.max(limit, 1), 60);
    return await cached(`recentDigests:${lim}:${excludeId ?? 0}`, 300_000, () => db.select({
      id: reports.id, type: reports.type, reportDate: reports.reportDate,
    }).from(reports)
      .where(and(
        eq(reports.type, 'daily'),
        sql`length(${reports.content}) > 0`,
        excludeId ? sql`${reports.id} <> ${excludeId}` : sql`1 = 1`,
      ))
      .orderBy(desc(reports.createdAt))
      .limit(lim));
  } catch (error) {
    console.error('Failed to fetch recent digests:', error);
    return [];
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
    await logError('getMyFavorites', error);
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
    await logError('getMyReadLater', error);
    return [];
  }
}

// ─── ページロード最適化: 複数クエリを1HTTP往復で取得 ────────────────────────

// Phase 1: 記事・ソース・レポートなど即表示が必要なコアデータを1往復で取得
// 朝刊（レポート）と「今日の注目」はここには含めない（2026-09-11）。本紙はトップ `/` が
// サーバーコンポーネントとして直接引いており、記事一覧 `/articles` の側では使わない。
export async function getCoreData(articleLimit = 60) {
  const [srcs, data, activity, counts] = await Promise.all([
    getSourcesData(),
    getCollectedDataList(articleLimit, 0),
    getActivityData(),
    getArticleCounts(),
  ]);
  return { srcs, data, activity, counts };
}

// SSR(公開ホーム)専用のコアデータ。auth()/cookies を一切読まないのが唯一にして最大の役割。
// getCoreData は getSourcesData(isOwner)・overlayUserState(currentUserId) 経由で cookies を読むため、
// これをSSRで await すると page.tsx が動的レンダリングに落ち、Vercelが
// `Cache-Control: private, no-cache, no-store` を付けてCDNキャッシュを完全に捨てる。
// 結果、全アクセスが関数のコールドスタートを踏んでいた（本番実測: ウォーム0.18s / コールド2.66〜3.83s）。
// ユーザー別状態(お気に入り/後で読む/既読)とsrcs(オーナー限定)は載せない。ログイン中の状態は
// 従来どおりクライアント側の getCoreData 再取得で後から上書きされる。
export async function getPublicCoreData(articleLimit = 12) {
  const [data, counts] = await Promise.all([
    getCollectedDataList(articleLimit, 0, true),
    getArticleCounts(true),
  ]);
  return { data, counts };
}

// ── v10: Web Push通知の購読 ─────────────────────────────────────────
// フロントは信用しない（原則6）: 購読オブジェクトはzodで検証し、長さ上限を課す。
// ログイン不要（匿名購読可）だが、濫用防止にレート制限をかける（endpoint単位のキー）。
const PushSubSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(300), auth: z.string().min(1).max(300) }),
});

export async function savePushSubscription(sub: unknown): Promise<{ success: boolean }> {
  try {
    const parsed = PushSubSchema.safeParse(sub);
    if (!parsed.success) return { success: false };
    const { endpoint, keys } = parsed.data;
    // 送信先を既知のプッシュサービスに限定する。任意URLを許すと、匿名で大量登録された行を
    // 毎朝のジョブが1件ずつPOSTしにいって配信が詰まる（＝Runner からのブラインドSSRFにもなる）。
    // これが主防御: 偽の購読を1件作るのに本物のFCM/Mozilla登録が要るので、量を作れなくなる。
    if (!isAllowedPushEndpoint(endpoint)) return { success: false };
    // レート制限は DB共有版にする。memRateLimit はインスタンス跨ぎで効かず、
    // Vercelでは並列に叩くだけでカウンタがリセットされる。
    if (!(await checkRateLimit('push', endpoint.slice(0, 64), 10, 60_000))) return { success: false };
    const userId = await currentUserId();
    // 同一endpointは差し替え（購読キー更新・ユーザー紐付け更新に対応）
    await db.insert(pushSubscriptions)
      .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, userId: userId ?? null })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { p256dh: keys.p256dh, auth: keys.auth, userId: userId ?? null },
      });
    return { success: true };
  } catch (error) {
    await logError('savePushSubscription', error, { alert: true });
    return { success: false };
  }
}

// endpoint の所持そのものが本人性の証明（Web Push の設計上そうなっている＝ブラウザが自分の
// endpoint を送る）。ログイン必須にすると匿名購読者が解除できなくなるので、認可は課さず
// 総当たり・DoS側だけ塞ぐ。
export async function deletePushSubscription(endpoint: unknown): Promise<{ success: boolean }> {
  try {
    if (typeof endpoint !== 'string' || endpoint.length > 1000) return { success: false };
    if (!isAllowedPushEndpoint(endpoint)) return { success: false };
    if (!(await checkRateLimit('push:del', endpoint.slice(0, 64), 10, 60_000))) return { success: false };
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    return { success: true };
  } catch (error) {
    await logError('deletePushSubscription', error, { alert: true });
    return { success: false };
  }
}
