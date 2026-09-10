// 記事どうしを「接続してよい語」を決める決定論ゲート。LLM・埋め込みは使わない。
//
// 用途は2つあるが機構は1つ:
//   ② 接続語を共有し、日付が近い   → 同じ出来事（ダイジェストで1本にまとめる＝重複排除）
//   ③ 接続語を共有し、日付が離れている → 続報（「これまでの経緯」の行に使う）
//
// ⚠️ 本番未接続。src/ からは一度も import されていない（利用は scripts/ とテストのみ）。
//    下の数字は「今こうなっている」ではなく「入れたらこうなる」の予測にすぎない。
//
// ⚠️ 2026-09-10 レッドチーム（別期間 06-20 / 07-08 / 08-13・595本）で以下を撤回した:
//   ・「誤接続0% / 本物60%」→ 別期間では **適合率56.5% / 誤接続40%**。
//     そもそも n=20 では誤接続0%は「真値が最大16.8%」としか言えず（Clopper-Pearson）、
//     25%→60% も Fisher 両側 p=0.054 で有意ではなかった。
//   ・「誤接続は4型しかない」→ **新期間で6型（E〜J）が出た。うち3型は塞いだはずの型の再発。**
//   ・「本物/弱い/誤接続」の判定基準はどこにも明文化されておらず、第三者が再測定できない。
//
// 判明した構造的な問題（閾値では直らない）:
//   E DFは特定性の代理にならない。「ドコモ」(DF37=0.16%) が4つの無関係な出来事を1本に潰した。
//     ハブ性は頻度でなく役割。AI中心コーパスでは日本の通信事業者は希少語だが通信ニュース内ではハブ。
//   F kuromoji が日本語一般語を固有名詞と誤タグする（自社/ローンチ/ハルシネーションが通過、
//     「トークン」→ トー[固有名詞]+クン[接尾]）。「型Aは品詞で塞げる」の前提が崩れている。
//   G ASCII 経路には品詞ゲートが無く、大文字始まりなら通る（PDF/JSON/OCR/RAG/MCP がキーになった）。
//     防御が isGenericEntity の手書きリストだけ＝新語に構造的に後手。
//   H 同名異物。Delta→Delta Electronics、Grok→grok-mermaid。「固有名詞 AND 非ハブ」の2軸では検出不能。
//   I HTMLエンティティ・URL 由来の分割＝型Cの別入口からの再発（`GPT&#45;5.6 Sol` → GPT + Sol）。
//   J 表記ゆれでキーが割れる見逃し（`DeepSeek V4 Pro 0813` vs `deepseek-v4-pro-0813`）。
//     再現率は一度も測っていなかった（適合率しか見ていない）。
//
// 測定そのものの欠陥:
//   ・HUB_RATIO の物差しが歪んでいる。DFは search_tokens（タイトル＋要約＋ソースドメイン）で
//     測るのに接続語はタイトルからしか取らない。Qwen は実際530本に出るのにDF396、GitHub は逆に370本ぶん過大。
//   ・2%の線は DF≥2 の455語のうち20語(4.4%)にしか触れていない。しかも観測された誤接続20ペアは
//     **全て閾値の下**（ゲートが意図的に通した語）から出ており、0.2%まで10倍締めても14ペア残る。
//   ・グローバルDFか記事日時点DFかで、595本中52本(8.7%)が同一性キーを変える＝出力が再現しない。
//
// 最も危うい仮定（ここが崩れている）: **「DFが低い語は特定の出来事を一意に指す」**。
//   偽のとき「最希少の1語を選ぶ」は「最も検証されていない語を選ぶ」に反転する。DF=2〜10 の語は
//   コーパス内に確かめる材料が2〜10本しか無い語であり、そこに記事を消す権限(②)と誤情報を出す権限(③)が集中する。
//
// ②と③で機構を1つにしたのも誤り。失敗の観測可能性が逆（②=サイレントな欠落 / ③=見える誤情報）で、
// ②に置いた唯一の保守側の梃子（4文字未満は merge しない）は実際の誤接続20ペアに一度も触れていない。
//
// 元の観測（4型・これ自体は実在する失敗）は下記。塞いだが、これで全部ではなかった:
//   A 一般語  「死ぬ」(DF32)→「売れ筋・死に筋を可視化する店舗DX」/「我々」「壊滅」「今月」
//   B 数値    「1300」(億トークン)→「AIカメラ1,300台で寮を監視」
//   C 分割    「Read the Docs」→ read/the/docs に割れて Google Docs へ
//             「Listen Labs」→ listen → Postgres LISTEN/NOTIFY
//   D 上限ミス DF上限50が airpods(51) gpt-6(64) huawei(85) siri(134) を捨てていた
//
// 「①固有名詞であること（品詞）AND ②ハブでないこと（DF）」の2軸で足りるとしたのも誤り（F/G/H が反例）。
// 当初「希少ならよい」と結論したのはさらに前の誤りで、それはエンティティ表（＝すでに固有名詞に
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
 *
 * ⚠️ 2026-09-10 のレッドチーム実測で**前方一致を削除した**。
 * `Siri AI ⊃ Siri` を拾うために入れていたが、別期間3日分で前方一致のみで成立した31組のうち
 * **およそ26組が誤マージ**だった:
 *   Pixel   → Pixel Watch 5 / Pixel 11シリーズ / Pixel Tag / 手話AIモデル が1つの出来事に（6組）
 *   DeepSeek→ V4 Pro 0813提供 / Harness利用可能 / 新料金体系 の3イベントが連結
 *   Copilot → Copilot Notebook の話 / MicrosoftがAI機能を廃止し統合
 * これは classifyTerms のコメントにある `iPhone`(DF280) の21本連鎖マージと完全に同型で、
 * 主キー方式では塞いだ穴が、こちらにはそのまま残っていた。`Pixel`(DF=84) は `iPhone`(280) より
 * 希少なのでDF閾値では捕まらない。守れていたのは `Siri` 1例だけなので、代償に見合わない。
 *
 * 重複と判定すると片方がダイジェストから消える＝サイレントな欠落なので、完全一致だけを採る
 * （失敗の非対称性: 見える冗長 ＜ サイレントな欠落）。
 */
export function sharedLinkTerms(a: string[], b: string[]): string[] {
  const bySurface = new Map<string, string>();
  for (const y of b) bySurface.set(y.toLowerCase(), y);
  const shared: string[] = [];
  for (const x of a) {
    if (x.length < 4) continue; // 短い一致では merge しない（保守側に倒す）
    const hit = bySurface.get(x.toLowerCase());
    if (hit) shared.push(x);
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
    // 2文字以下のASCII略語は曖昧すぎる。本番実測で `IT` が拾われ、FTSが
    // モデル名の `gemma-4-12b-it`（instruction-tuned の it）に一致して
    // 「AIがITセクターを30兆ドルに」と「IT企業CEOに変身した16人の俳優」を同じ出来事にした。
    if (/^[A-Za-z0-9.+-]{1,2}$/.test(term)) continue;
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

/**
 * 記事の接続語を「同一性に使う1語」と「多様性の制御に使うハブ語」に分ける。
 *
 * 2026-09-10 の本番実測で必要になった。1日ぶん333本を組んだところ、
 * `iPhone`(DF280) が **21本を鎖状に連結**し、折りたたみiPhone・iPhone 18 Pro・AirPods を
 * 1つの出来事にまとめてしまった（[[debug-story-overmerge]] の連鎖マージと同じ型）。
 * さらに `iOS`(DF192) が「iMacやiPhoneをデザインした元Apple社員がフェラーリの…」に誤接続した。
 *
 * 原因は閾値ではなく、**一般名（iPhone / iOS）と固有名（iPhone Duo / iPhone 18 Pro）が同居**すること。
 * 最も希少な1語だけを同一性の根拠にすれば、iPhone Duo と AirPods は別の出来事に分かれる。
 *
 * 一方でハブ語（Apple など）は捨てずに返す。**1社が朝刊を占拠しないための編集制御**に使う
 * ＝ ハブ語の唯一の正しい用途。同一性には絶対に使わない。
 */
export function classifyTerms(
  terms: string[],
  dfOf: (t: string) => number,
  corpusSize: number,
): { primary: string | null; hubs: string[] } {
  const usable: Array<[string, number]> = [];
  const hubs: string[] = [];
  for (const t of terms) {
    const df = dfOf(t);
    if (df < 2) continue;                       // 自分の記事にしか無い＝接続先が存在しない
    if (isHubTerm(df, corpusSize)) { hubs.push(t); continue; }
    usable.push([t, df]);
  }
  usable.sort((a, b) => a[1] - b[1] || b[0].length - a[0].length);
  return { primary: usable.length ? usable[0][0] : null, hubs };
}
