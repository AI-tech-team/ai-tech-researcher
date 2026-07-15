/**
 * 検索クエリの分割（実行時・Vercel側）。
 *
 * kuromoji はここでは使わない（辞書15MBのロードでコールドスタートが伸びる）。
 * 代わりに、パイプラインが kuromoji で作った語彙(search_vocab)に対して最長一致で切る。
 * 実測（2026-07-15）: この方式でも Recall@5=90% / MRR=0.825 と、実行時kuromojiと同値。
 */

// 英数字（GPT-5.6 等）を分割から守るための番人。scripts/lib/search-analyzer.ts と同じ値（U+E000）。
const SENT = '';
const KANJI_KATAKANA = /[\p{Script=Han}\p{Script=Katakana}ー々]/u;

/** クエリから語彙照合の候補となる部分文字列（2〜10文字）を列挙する。search_vocab を1回引くために使う。 */
export function vocabCandidates(query: string): string[] {
  const { masked } = protectAscii(query);
  const out = new Set<string>();
  for (const part of masked.split(SENT)) {
    const s = part.toLowerCase();
    for (let len = 2; len <= 10; len++) {
      for (let i = 0; i + len <= s.length; i++) {
        const sub = s.slice(i, i + len);
        if (/^[\s、。,.!?！？「」（）()]+$/.test(sub)) continue;
        out.add(sub);
      }
    }
  }
  return [...out].slice(0, 300); // クエリは最大100文字なので上限は保険
}

function protectAscii(text: string): { masked: string; holds: string[] } {
  const holds: string[] = [];
  const masked = String(text ?? '').replace(/[A-Za-z][A-Za-z0-9.\-_]*/g, (m) => {
    holds.push(m.replace(/[.\-_]+$/, '').toLowerCase());
    return SENT;
  });
  return { masked, holds };
}

export type Segmented = {
  tokens: string[];
  /** クエリに「コーパスに存在しない内容語」が含まれている（＝該当なしを返すべき） */
  unknown: boolean;
};

/**
 * 語彙に対する最長一致でクエリを分割する。
 * 漢字/カタカナが2文字以上連続する部分がどの語にも覆われなかった場合、
 * それはコーパスが知らない内容語（例:「アボカド」）とみなし unknown=true を返す。
 * ひらがなは助詞・活用語尾が多いので判定に使わない。
 */
export function segmentQuery(query: string, vocab: Set<string>): Segmented {
  const { masked, holds } = protectAscii(query);
  const tokens: string[] = [];
  let unknown = false;
  let hi = 0;

  for (const part of masked.split(SENT)) {
    const s = part.toLowerCase();
    const covered = new Array(s.length).fill(false);
    let i = 0;
    while (i < s.length) {
      let hit: string | null = null;
      for (let len = Math.min(10, s.length - i); len >= 2; len--) {
        const sub = s.slice(i, i + len);
        if (vocab.has(sub)) { hit = sub; break; }
      }
      if (hit) {
        tokens.push(hit);
        for (let k = 0; k < hit.length; k++) covered[i + k] = true;
        i += hit.length;
      } else {
        i += 1;
      }
    }
    // 覆われなかった漢字/カタカナの連続を探す
    let run = 0;
    for (let k = 0; k <= s.length; k++) {
      const isUncoveredContent = k < s.length && !covered[k] && KANJI_KATAKANA.test(s[k]);
      if (isUncoveredContent) { run++; } else { if (run >= 2) unknown = true; run = 0; }
    }
    if (hi < holds.length) { const h = holds[hi++]; if (h) tokens.push(h); }
  }
  // 退避した英数字が余っていたら回収（部分文字列が空だった場合など）
  while (hi < holds.length) { const h = holds[hi++]; if (h) tokens.push(h); }

  return { tokens: [...new Set(tokens.filter(Boolean))], unknown };
}

/** FTS5 の MATCH 式に変換（各語をフレーズにして OR。BM25 が共起の多い記事を上位に出す）。 */
export function toMatchExpr(tokens: string[]): string | null {
  const safe = tokens.map(t => t.replace(/"/g, '')).filter(t => t.length >= 2);
  if (!safe.length) return null;
  return safe.map(t => `"${t}"`).join(' OR ');
}
