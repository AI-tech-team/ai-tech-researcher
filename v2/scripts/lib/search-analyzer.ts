/**
 * 検索用の形態素解析（パイプライン専用）。
 *
 * kuromoji(IPADic) で日本語を単語に分割し、内容語だけを索引語として返す。
 * Vercel側には載せない（辞書15MBのロードでコールドスタートが伸びるため）。
 * 実行時の分割は、ここで作った語彙(search_vocab)を使う最長一致で行う（src/lib/search-tokens.ts）。
 *
 * 実測（2026-07-15・記事1万件・正解既知20問）:
 *   自作n-gram辞書 Recall@5=75% / kuromoji=90%。自作の複合語結合や自作Viterbiは逆に悪化した。
 */
import kuromoji from 'kuromoji';

// 英数字（GPT-5.6, vLLM 等）を解析前に退避するための番人。IPADicは "GPT-5.6" を GPT|-|5|.|6 に粉砕するため。
export const SENT = ''; // Unicode私用領域。記事本文には出現しない
const CONTENT_POS = new Set(['名詞', '動詞', '形容詞']);

let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;

export async function initAnalyzer(dicPath = 'node_modules/kuromoji/dict') {
  if (tokenizer) return;
  tokenizer = await new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t)));
  });
}

/** 英数字を番人に置き換えて退避する。戻り値の holds は元の英数字（小文字化済み）。 */
export function protectAscii(text: string): { masked: string; holds: string[] } {
  const holds: string[] = [];
  const masked = String(text ?? '').replace(/[A-Za-z][A-Za-z0-9.\-_]*/g, (m) => {
    holds.push(m.replace(/[.\-_]+$/, '').toLowerCase());
    return SENT;
  });
  return { masked, holds };
}

/** テキストを索引語（内容語＋英数字）の配列にする。動詞・形容詞は基本形に正規化。 */
export function analyze(text: string): string[] {
  if (!tokenizer) throw new Error('initAnalyzer() を先に呼ぶこと');
  const { masked, holds } = protectAscii(text);
  const out: string[] = [];
  let hi = 0;
  for (const t of tokenizer.tokenize(masked)) {
    if (t.surface_form.includes(SENT)) {
      for (const ch of t.surface_form) {
        if (ch === SENT) { const h = holds[hi++]; if (h) out.push(h); }
      }
      continue;
    }
    if (!CONTENT_POS.has(t.pos)) continue;
    const w = t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form;
    out.push(w.toLowerCase());
  }
  // FTS5(unicode61)は空白区切りで語を切るため、語内の空白は潰す
  return [...new Set(out.map(w => w.replace(/\s+/g, '')).filter(w => w.length >= 2))];
}
