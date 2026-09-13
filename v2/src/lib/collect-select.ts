// 収集で「どれを評価（＝LLM課金）に回すか」を決める共通則。
//
// **鉄則: 広く取る → 重複を除く → 意味のある順に並べ替える → 上限で絞る。**
// 現場で壊れていたのは、いつも「絞る」が先に来ている形だった。
//
// ⚠ 位置に意味を仮定しない。APIやフィードが返す順が重要度順・日付順とはかぎらない。
//   実測(2026-09-13):
//   - HF daily_papers は upvote 順で返らない。👍444 の筆頭論文が30件中**27番目**にいた。
//     先頭8件を取ると👍20・👍8を評価して444を捨てる（票合計 200 対 1209＝6.0倍）
//   - RSSフィード40本のうち、読めた34本の**6本(17.6%)が降順でない**
//     （NVIDIA Developer Blog は最新が2番目）。「フィードは新しい順」は成り立たない
//   - Hacker News は順位＝スコアではない。top150 に条件を満たすAI記事が13件あり、
//     先頭から5件で打ち切ると▲1191・▲932・▲666 を落として▲129を拾う
//
// ⚠ 絞るのは必ず重複除去の後。逆にすると「上位が既知になった日に0件」で静かに止まる
//   → [[pattern-throughput-starvation]]（github-trending はこれで77日間0件だった）
//   収集で落としたものは戻らない → [[pattern-filter-by-recoverability]]
export function topByScore<T>(items: T[], getScore: (t: T) => number, limit: number): T[] {
  // 同点は元の順を保つ（Array.prototype.sort は安定）。元の並びを次の手がかりとして残す。
  // スコアが数値にならないもの（日付なしのフィード項目など）は 0 として最後に回す。
  const score = (t: T) => { const n = getScore(t); return Number.isFinite(n) ? n : 0; };
  return [...items].sort((a, b) => score(b) - score(a)).slice(0, limit);
}
