import { sql } from 'drizzle-orm';
import { collectedData } from '@/db/schema';

/**
 * 「AIの話か」を importance_score から切り離した列 `ai_relevance` の使いどころ。
 *
 * なぜ列を分けたか: importance_score 1本に「AIの話か」と「記事として重要か」を兼任させていた頃、
 * よく書けた無関係記事が高得点になり、「新潟駅徒歩圏で完結する1泊2日観光モデルルート」★9 が
 * 朝刊の候補に入っていた（2026-09-12 実測。この記事は ai_relevance=0 で正しく捕まる）。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠ **閾値は 1。4 や 6 で切ってはいけない。**
 *
 * 全23,351件をバックフィルして実測した（2026-09-13）。分布は 0:12.2% / 3:12.3% / 7:22.7% / 10:52.8%
 * と割れていて 4〜6 はほぼ空＝一見「4で切れば良い」ように見える。**が、中身を見ると違った。**
 *
 *   スコア3（2,865件）に混ざっていた本物:
 *     ★10 Nvidia closing in on US$100B credit guarantee deal for OpenAI
 *     ★8  CoWoS, wafer-scale and CoWoP: Why AI packaging bottleneck …
 *         NVIDIA Cosmos-H-Dreams / LG×Nvidia humanoid / Claude Code の利用上限 / Weights&Biases
 *   無作為20件のうち8件（40%）がAI記事。固有名詞（PyTorch/Claude/Nvidia/OpenAI等）が
 *   タイトルに入る記事だけ数えても 215件がスコア3にいた。
 *
 *   スコア0（2,839件）は概ね妥当: 観光モデルルート / ソロ航海 / 1993風FPS / 通信4社の勝敗。
 *   固有名詞ありは 46件（1.6%）まで落ちる＝スコア3の 1/5 の密度。
 *
 * 4で切ると 5,704件（24.4%）が対象になり、そのうち1,000件以上が本物だった。
 * 0だけを外せば対象は 2,839件（12.2%）で、取りこぼしの密度は1/5になる。
 * ─────────────────────────────────────────────────────────────
 *
 * ⚠ **NULL を落としてはいけない。** NULL は「AI無関係」ではなく「まだ判定していない」。
 *   HN経路で本文が取れずLLMに通せなかった記事は意図的に NULL のまま入る。
 *   ここで NULL を弾くと、判定できなかったものが理由も分からず消える（サイレントな消失）。
 */
export const MIN_AI_RELEVANCE = 1;

/**
 * `ai_relevance = 0`（＝AIと無関係と明示判定されたもの）だけを外す述語。
 *
 * ⚠ **掛けてよい場所と、絶対に掛けてはいけない場所がある。判断基準は「回復可能か」。**
 *
 *   掛ける（外しても記事は残り、検索と直リンクで必ず辿れる＝回復可能）:
 *     - 朝刊の候補プール（daily-report.ts）… 外れても翌日以降も候補に残る
 *     - /articles の一覧・カテゴリ別・タグ別（actions.ts）
 *
 *   掛けない（外れると二度と辿り着けない＝回復不能）:
 *     - **検索**。探している本人に対して隠すのは検索の否定。判定のぶれが致命的になる
 *     - **トピックページの関連記事**・記事ページ本体（getArticleById）
 *       … メールやSNSで配ったリンクが後から404になるほうが害が大きい
 *     - **収集そのもの**。DBに入れなければ復旧手段が無い（→ daily_pipeline.ts の AI_RELEVANCE_MIN）
 */
export const AI_RELEVANT_SQL = sql`(${collectedData.aiRelevance} IS NULL OR ${collectedData.aiRelevance} >= ${MIN_AI_RELEVANCE})`;
