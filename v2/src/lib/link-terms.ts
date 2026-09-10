// 記事どうしを「接続してよい語」を決める決定論ゲート。LLM・埋め込みは使わない。
//
// 用途は2つあるが機構は1つ:
//   ② 接続語を共有し、日付が近い   → 同じ出来事（ダイジェストで1本にまとめる＝重複排除）
//   ③ 接続語を共有し、日付が離れている → 続報（「これまでの経緯」の行に使う）
//
// 2026-09-10 の本番実測（重要記事20本を目視判定）で、素の語で引くと
// **本物25% / 全て誤接続50%** だった。誤接続は4型しかなく、ここで全部塞ぐ:
//   A 一般語  「死ぬ」(DF32)→「売れ筋・死に筋を可視化する店舗DX」/「我々」「壊滅」「今月」
//   B 数値    「1300」(億トークン)→「AIカメラ1,300台で寮を監視」
//   C 分割    「Read the Docs」→ read/the/docs に割れて Google Docs へ
//             「Listen Labs」→ listen → Postgres LISTEN/NOTIFY
//   D 上限ミス DF上限50が airpods(51) gpt-6(64) huawei(85) siri(134) を捨てていた
//
// 正しい規則は **①固有名詞であること（品詞）AND ②ハブでないこと（DF）** の2軸。
// 当初「希少ならよい」と結論したのは誤りで、それはエンティティ表（＝すでに固有名詞に
// 絞り込まれたもの）で測った結果を素の語に一般化してしまったため（[[pattern-coverage-is-not-outcome]]）。

import { isGenericEntity } from './entity-quality';

/** kuromoji の解析結果のうち、この判定に必要な分だけ。辞書ロードは呼び出し側の責任（純粋関数に保つため）。 */
export type PosToken = {
  surface: string;
  pos: string;      // 名詞 / 動詞 ...
  d1: string;       // pos_detail_1: 固有名詞 / 一般 / 数 / サ変接続 ...
  d2?: string;      // pos_detail_2: 組織 / 人名 / 地域 ...
};

/**
 * タイトル先頭に混入した内部ID。本番実測で `[3800] 量子化アウェアトレーニング…`
 * `[8962] Shopify、PyTorch Foundation…` が存在し、検索索引にも入っていた。
 * 記事ID「3800」が「2万3800円」に一致して誤接続を起こしていたので、必ず落とす。
 */
export function stripInternalIdPrefix(title: string): string {
  return (title ?? '').replace(/^\s*\[\d{1,7}\]\s*/, '').trim();
}

const asciiDashes = (s: string) => s.replace(/[‐-―−]/g, '-');

/** 版番号・型番（2.5 / 3.8 / 5）。単独では接続語にならないが、固有名詞の後ろに付くと句の一部になる。 */
const VERSIONISH = /^\d+(\.\d+)*$/;
/** 固有名らしいASCII語: 先頭大文字（Accenture, Siri）/ 全大文字（DDoS, AWS）/ camelCase（iPhone, eBay）。 */
const ASCII_PROPER = /^(?:[A-Z][A-Za-z0-9.+\-]*|[a-z][A-Z][A-Za-z0-9.+\-]*)$/;
/** 固有名の内部に現れる小文字の機能語。`Read the Docs` `Bank of America` を割らないために許す。 */
const INNER_FUNC = new Set(['the', 'of', 'for', 'and', 'de', 'la', 'du', 'von', 'van']);

/**
 * 末尾の版番号を落とした形（`AirPods 5` → `AirPods`）。
 * **落とすのは末尾の数字だけ**。頭の語を取り出すことはしない
 * （`Listen Labs` → `Listen` にすると Postgres LISTEN/NOTIFY へ誤接続する＝型Cの再発）。
 */
export function baseFormOf(phrase: string): string {
  const w = phrase.trim().split(/\s+/);
  while (w.length > 1 && VERSIONISH.test(w[w.length - 1])) w.pop();
  return w.length > 1 || !VERSIONISH.test(w[0]) ? w.join(' ') : '';
}

/**
 * 2つの記事の接続語が「同じものを指している」か（規則②＝重複判定に使う）。
 * `Siri AI` と `Siri` のように、片方がもう片方の**語の先頭からの並び**なら同じとみなす。
 * 重複と判定すると片方がダイジェストから消える＝サイレントな欠落なので、
 * 4文字未満の短い一致では merge しない（保守側に倒す）。
 */
export function sharedLinkTerms(a: string[], b: string[]): string[] {
  const shared: string[] = [];
  for (const x of a) for (const y of b) {
    const [s, l] = x.length <= y.length ? [x.toLowerCase(), y.toLowerCase()] : [y.toLowerCase(), x.toLowerCase()];
    if (s.length < 4) continue;
    if (s === l || l.startsWith(s + ' ')) shared.push(x.length <= y.length ? x : y);
  }
  return [...new Set(shared)];
}

/**
 * ASCII の固有名詞句を、**割らずに**取り出す（誤接続の型C対策）。
 * 日本語に挟まれた連続ASCII列を1つの run として見て、その中で句を組み立てる。
 */
export function extractAsciiPhrases(title: string): string[] {
  const out: string[] = [];
  const runs = asciiDashes(stripInternalIdPrefix(title)).match(/[A-Za-z0-9][A-Za-z0-9 .+\-]*/g) ?? [];

  for (const run of runs) {
    const words = run.trim().split(/\s+/).filter(Boolean);
    let cur: string[] = [];

    const flush = () => {
      // 末尾の版番号だけが残った形（`2.5` 単独）や、固有名を含まない句は捨てる
      while (cur.length && VERSIONISH.test(cur[cur.length - 1]) && cur.length === 1) cur.pop();
      if (cur.some((w) => ASCII_PROPER.test(w))) {
        // 先頭・末尾の機能語を落とす（`the Docs` にならないように）
        while (cur.length && INNER_FUNC.has(cur[0].toLowerCase())) cur.shift();
        while (cur.length && INNER_FUNC.has(cur[cur.length - 1].toLowerCase())) cur.pop();
        const phrase = cur.join(' ').replace(/[.\-]+$/, '');
        if (phrase.length >= 2) out.push(phrase);
        // 版番号を落とした形も候補にする。本番のFTS索引は `AirPods 5` `Images 2.5` を
        // 句として引けず DF=0 になり、**前回当たっていた Images 2.5 の経緯を落としていた**。
        // `Images`(11) `AirPods`(51) なら引ける。どちらもDFゲートに別々にかける。
        const base = baseFormOf(phrase);
        if (base && base !== phrase) out.push(base);
      }
      cur = [];
    };

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const isProper = ASCII_PROPER.test(w);
      const isVer = VERSIONISH.test(w);
      // 機能語は「前後を固有名に挟まれている」ときだけ句の内部として認める
      const isInner = INNER_FUNC.has(w.toLowerCase())
        && cur.length > 0
        && i + 1 < words.length && ASCII_PROPER.test(words[i + 1]);

      if (isProper || isInner || (isVer && cur.length > 0)) cur.push(w);
      else flush();
    }
    flush();
  }
  return out;
}

/** 日本語側: 固有名詞だけを拾う。数詞・一般名詞・サ変接続（警告/退職/壊滅）はここで落ちる（型A・型B対策）。 */
export function extractJaProperNouns(posTokens: PosToken[]): string[] {
  const out: string[] = [];
  for (const t of posTokens) {
    if (t.pos !== '名詞' || t.d1 !== '固有名詞') continue;
    if (t.d2 === '地域') continue;                 // 中国・日本・東京は接続語にならない
    if (/^[A-Za-z0-9 .+\-]+$/.test(t.surface)) continue; // ASCII は句として別経路で取る
    if (t.surface.length < 2) continue;
    out.push(t.surface);
  }
  return out;
}

/**
 * 接続語の候補を出す。DF（コーパス内出現数）によるハブ除外は `isHubTerm` で別に行う
 * ＝ここは辞書だけで決まる純粋関数なのでテストできる。
 */
export function extractLinkTerms(title: string, posTokens: PosToken[] = []): string[] {
  const raw = [...extractAsciiPhrases(title), ...extractJaProperNouns(posTokens)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of raw) {
    if (isGenericEntity(term)) continue;           // AI / LLM / US / CEO / 中国 …
    if (VERSIONISH.test(term)) continue;           // 数値単独（型B）
    const k = term.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(term);
  }
  return out;
}

/**
 * ハブ語か（型D）。閾値は本番実測のラベルに合わせた:
 *   接続語として機能した: huawei 85 / siri 134 / deepseek 294 / qwen 396  （0.4%〜1.7%）
 *   ハブで機能しなかった: apple 727 / anthropic 1152 / google 1292 / openai 1388（3.2%〜6.1%）
 * 境界は 2% に置く。**8語の観測から引いた線なので、コーパスが変わったら測り直すこと。**
 */
export const HUB_RATIO = 0.02;
export function isHubTerm(df: number, corpusSize: number): boolean {
  if (corpusSize <= 0) return false;
  return df / corpusSize > HUB_RATIO;
}

/** 接続語として使えるか（DFまで含めた最終判定）。df < 2 は自分の記事にしか無い＝接続先が存在しない。 */
export function isUsableLinkTerm(term: string, df: number, corpusSize: number): boolean {
  if (df < 2) return false;
  return !isHubTerm(df, corpusSize);
}
