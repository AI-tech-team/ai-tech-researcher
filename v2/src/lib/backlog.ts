/**
 * 「上限 < 流入」で静かに劣化していないかを、毎日1行で出すだけの道具。
 *
 * なぜ要るか: この形の不具合は**本番で15箇所**見つかっている（処理側5・収集側4・工程全体6）。
 * 共通しているのは「上限に当たっても誰も気づかない」こと。月次レポートは★10だけで枠が埋まって
 * **14日分が欠落**していたし、sitemap は**1日未満**しか載っていなかった。どちらも動いてはいたので
 * エラーにならず、出力を数えるまで誰も知らなかった。
 *
 * ⚠ **恒久対策として決めていたのに、実装されていなかった**（2026-09-15 に参照0件で発見）。
 *   記録に「恒久対策=reportBacklog()で毎日『残りn件（上限m件）』」と残っていたが、
 *   その名前の関数はリポジトリのどこにも無かった。決めたことが入っていないのを検知できるのは
 *   「呼び出し0件」の機械的な検査だけなので、その意味でもここに実体を置いておく。
 *
 * ## いまは枯渇していない（2026-09-15・バックアップで60日分を実測）
 * | 上限 | 効いた日 | 実測の分布 |
 * |---|---|---|
 * | `CANDIDATE_LIMIT = 120` | **0/60日** | 候補数 最小10 / 中央36 / 最大63 |
 * | `TOP_N = 40` | 12/60日 | ドメイン上限後 最大53 |
 *
 * `TOP_N` が効く日があるのは仕様どおり（40件は「LLMに渡す材料」で、載せる約束は5本。
 * 最も薄い日でも22本ある）。`CANDIDATE_LIMIT` は最大63に対して120なので、まだ倍近い余裕がある。
 * **問題は、この余裕が無くなった日に誰も気づけないこと**。だから毎日出す。
 */

export interface BacklogStage {
  /** ログに出す名前 */
  name: string;
  /** 実際に取れた件数 */
  got: number;
  /** その工程の上限 */
  cap: number;
}

/** 上限に対する余裕が乏しい（=もうすぐ静かに落ち始める）と見なす割合。 */
export const BACKLOG_WARN_RATIO = 0.8;

/**
 * 1行にまとめる。**判断はせず数字を出すだけ**。
 * `got >= cap` は既にこぼれている、`got >= cap * 0.8` はもうすぐこぼれる。
 */
export function formatBacklog(stages: BacklogStage[]): string {
  if (stages.length === 0) return '[Backlog] 対象なし';
  const parts = stages.map(s => {
    const mark = s.got >= s.cap ? ' ⚠上限に到達' : s.got >= s.cap * BACKLOG_WARN_RATIO ? ' ⚠余裕わずか' : '';
    return `${s.name} ${s.got}/${s.cap}（余裕${Math.max(s.cap - s.got, 0)}）${mark}`;
  });
  return `[Backlog] ${parts.join(' | ')}`;
}

/** 1つでも上限に達していれば true（呼び出し側が通知に使えるように）。 */
export function hasBacklog(stages: BacklogStage[]): boolean {
  return stages.some(s => s.got >= s.cap);
}
