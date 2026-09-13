// 収集とレポートで「どれを選ぶか」を決める共通則。
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

// 期間レポート（週次・月次）の候補を**日ごとに均等**に取る。
//
// ⚠ `importance DESC, created_at DESC LIMIT n` は、同点が多いと**新しい日だけ**を拾う。
//   実測(2026-09-06のバックアップ):
//   - 月次は30日窓に6,469件・★10が173件あり、上位100件は**★10だけで埋まって17日分**しか入らない。
//     **08-07〜08-20 の14日間が1件も入っていなかった**＝「月次」と名乗って半月の話をしていた
//   - 週次は7日窓に1,599件・★10=48件。残り22枠を★9(300件)から新着順に取るので最終日に偏る
//   同点の並びが日付なら、上限で切った瞬間に「期間」が縮む。件数は合っているので気づけない。
//
// → 日ごとに枠を回す（ラウンドロビン）。各日の中はスコアの高い順。
//   どの日も最低1件は必ず入り、上限が余れば2周目・3周目で埋まる。
export function spreadByDay<T>(items: T[], getDay: (t: T) => string, getScore: (t: T) => number, limit: number): T[] {
  if (limit <= 0) return [];
  const byDay = new Map<string, T[]>();
  for (const it of items) {
    const d = getDay(it);
    const arr = byDay.get(d);
    if (arr) arr.push(it); else byDay.set(d, [it]);
  }
  const days = [...byDay.keys()].sort().reverse(); // 新しい日から配る
  for (const d of days) byDay.set(d, topByScore(byDay.get(d)!, getScore, Number.MAX_SAFE_INTEGER));

  const out: T[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const d of days) {
      const arr = byDay.get(d)!;
      if (round >= arr.length) continue;
      out.push(arr[round]);
      added = true;
      if (out.length >= limit) break;
    }
    if (!added) break; // 全部の日を配り切った（items が limit より少ない）
  }
  return out;
}
