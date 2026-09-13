import { sql } from 'drizzle-orm';
import { collectedData } from '@/db/schema';

/**
 * 表示側で「AIの話でない記事」を落とすための閾値と述語。
 *
 * なぜ列を分けたか: importance_score 1本に「AIの話か」と「記事として重要か」を兼任させていた頃、
 * よく書けた無関係記事が高得点になり、「新潟駅徒歩圏で完結する1泊2日観光モデルルート」★9 が
 * 朝刊の候補に入っていた（2026-09-12 実測）。プロンプトの指示では直らず、構造で分けて解決した。
 *
 * ⚠ **NULL を落としてはいけない。** NULL は「AI無関係」ではなく「まだ判定していない」。
 *   HN経路で本文が取れずLLMに通せなかった記事は意図的に NULL のまま入る。
 *   ここで NULL を弾くと、判定できなかったものが理由も分からず消える（サイレントな消失）。
 *
 * ⚠ 記事そのもののページ（getArticleById）には**掛けない**。
 *   メールやSNSで配ったリンクが後から404になるほうが害が大きい。落とすのは一覧・検索・トピック。
 */
export const MIN_AI_RELEVANCE_DISPLAY = 4;

/** 一覧・検索・トピックの WHERE に足す述語。 */
export const AI_RELEVANT_SQL = sql`(${collectedData.aiRelevance} IS NULL OR ${collectedData.aiRelevance} >= ${MIN_AI_RELEVANCE_DISPLAY})`;

/**
 * 生SQL用（FTS5 との JOIN など drizzle の式を使えない場所）。`alias` は collected_data 側の別名。
 *
 * ⚠ 検索は「先に絞ってから LIMIT」にすること。後段で落とすと、無関係な記事が上位の枠を
 *   食い潰して本来出るはずの記事が出なくなる（LIMITを書いたら流入と比較する
 *   → [[pattern-throughput-starvation]]）。
 */
export function aiRelevantRaw(alias = ''): string {
  const col = alias ? `${alias}.ai_relevance` : 'ai_relevance';
  return `(${col} IS NULL OR ${col} >= ${MIN_AI_RELEVANCE_DISPLAY})`;
}
