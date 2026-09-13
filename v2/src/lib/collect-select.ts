// 収集で「どれを評価（＝LLM課金）に回すか」を決める共通則。
//
// ⚠ APIが返す順が重要度順とはかぎらない。先頭から slice すると、並びを暗黙の前提にしてしまう。
//   実測(2026-09-13, HF daily_papers 30件): この API は upvote 順ではなく、
//   👍444 の筆頭論文が **27番目** に入っていた。先頭8件を取ると👍20・👍8を評価して444を捨てる。
//   先頭8件の票合計 200 に対し、上位8件は 1209（6.0倍）。
//   → 絞る前に並べ替える。落としたものは戻らない → [[pattern-filter-by-recoverability]]
export function topByVotes<T>(items: T[], getVotes: (t: T) => number, limit: number): T[] {
  // 同票は元の順を保つ（Array.prototype.sort は安定）。APIの並びを票の次の手がかりとして残す。
  return [...items].sort((a, b) => getVotes(b) - getVotes(a)).slice(0, limit);
}
