// 知識グラフ（claims / benchmarks / relations）の品質ゲート。決定論のみ・LLMも埋め込みも使わない。
//
// 2026-09-10 の本番実測（relations 851件 / benchmarks 466件 / claims 2,858件）で分かったこと:
//   - `acquired_by` 147件は**ほぼ全滅**。`AMD ← Nvidia` `Nvidia ← TSMC` `Apple ← Nvidia`
//     `Cloudflare ← Cloudflare Turnstile` `Block ← Generative AI` `OpenAI ← マルタ`。
//     しかも唯一事実だった「OpenAI が Ona を買収」も `OpenAI --acquired_by--> Ona` と**向きが逆**だった。
//   - 原因は2つ。①`acquired_by` が**受動名**なのに、LLMは subject に「記事の主役」を入れるため向きが定まらない。
//     ②型が6種しかなく「開発元・製造委託・提訴・規制措置」の受け皿が無いため、企業同士の関係が
//     すべて acquired_by に流れ込んでいた（＝選択肢不足による強制的な誤分類）。
//   - benchmarks はユニーク名311/466件＝ほぼ一度きり。`tok/s` `decode` `unknown` `Commits (Day 1) 11 commits`
//     `2026年売上高見通し 430億ユーロ` のようにベンチマークですらない行が多数あった。
//   - claims は大半が有用だが、`ChatGPT / ヤコビ予想の反例を持つ可能性を示唆 = true`（推測＋真偽値）や
//     predicate が丸ごと文になっている行が混じっていた。
//
// 方針: 判定は再現可能・無料であるべきなので推定を使わない（[[pattern-embedding-cannot-separate]]）。
// 失敗の非対称性は「誤情報を公開する > 情報が欠ける」なので、迷ったら落とす側に倒す（CLAUDE.md 第三条）。

import { isGenericEntity } from './entity-quality';

// ── エンティティ ──────────────────────────────────────────────────────
/** 文の断片・一般名詞をエンティティとして弾く（ASCIIで大文字/数字が無い＝固有名詞でない可能性大） */
export function looksLikeEntity(s: string): boolean {
  const t = (s ?? '').trim();
  if (!t || t.length > 40) return false;
  if (/[、,]/.test(t)) return false;            // カンマ/読点 = 文の断片
  if (t.split(/\s+/).length > 5) return false;  // 単語数過多 = 文
  const hasCJK = /[ぁ-んァ-ヶ一-龯]/.test(t);
  const hasUpperOrDigit = /[A-Z0-9]/.test(t);
  if (!hasCJK && !hasUpperOrDigit) return false; // 小文字ASCIIのみ = 一般名詞の可能性大
  return true;
}

/** 比較用の正規化キー（normalizeEntityKey と同じ形。日本語を残す＝2026-09-10 修正） */
function entKey(s: string): string {
  return (s ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶー一-龯]/g, '');
}

// ── 関係 ──────────────────────────────────────────────────────────────
// すべて**能動態**で「subject が object に対して行う」向きに統一する。
// 受動名（旧 acquired_by）は、LLMが subject に記事の主役を置く癖と衝突して向きが壊れるため使わない。
export const RELATION_TYPES = [
  'outperforms',   // A が B を性能で上回る
  'competes_with', // A と B が競合（対称）
  'partners_with', // A と B が提携（対称）
  'builds_on',     // A が B を基盤にしている
  'develops',      // A が B を開発・提供している（企業 → モデル/製品）
  'acquires',      // A が B を買収した
  'invests_in',    // A が B に出資した
  'supplies',      // A が B に供給・製造している
  'cites',         // A が B を引用している
  'supersedes',    // A が B を置き換える後継である
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

/** 向きに意味が無い（A-B と B-A が同じ）関係。重複エッジを防ぐため辞書順に正規化する */
const SYMMETRIC = new Set<string>(['competes_with', 'partners_with']);

/**
 * 一方が他方の名前を含む場合に成立しえない関係。
 * 実測例: `Cloudflare --acquired_by--> Cloudflare Turnstile`（自社製品を買収したことになっていた）。
 * develops / builds_on / cites は「Anthropic develops Anthropic Claude」のように包含でも正しいので対象外。
 */
const CONTAINMENT_INVALID = new Set<string>([
  'acquires', 'competes_with', 'outperforms', 'supersedes', 'invests_in', 'partners_with',
]);

/**
 * 「組織しか主体・対象になれない」関係。買収・出資・供給・提携は、相手が概念だと必ず誤りになる。
 * 実測: `Block --acquired_by--> Generative AI`。
 */
const ORG_ONLY = new Set<string>(['acquires', 'invests_in', 'supplies', 'partners_with']);

// 概念語。entity-quality の GENERIC_KEYS には**あえて入れていない**（`Generative AI` は
// トピックとしては成立するため）が、企業間アクションの相手にはなりえない。
const CONCEPT_KEYS = new Set([
  'generativeai', 'agi', 'asi', 'machinelearning', 'deeplearning', 'neuralnetwork', 'neuralnetworks',
  'transformer', 'transformers', 'diffusionmodel', 'diffusionmodels', 'rag', 'promptengineering',
  'finetuning', 'reinforcementlearning', 'rlhf', 'agenticai', 'multimodalai', 'computervision',
  'nlp', 'quantumcomputing', 'blockchain', 'opensource', 'foundationmodel', 'foundationmodels',
  '生成ai', '人工知能', '機械学習', '深層学習', '大規模言語モデル', '基盤モデル',
]);

/** 概念であって組織でないか（企業間アクションの相手として不正） */
export function isConceptEntity(name: string): boolean {
  return CONCEPT_KEYS.has(entKey(name));
}

/**
 * 関係として保存してよいか。
 * 一般名詞（AI / China / CEO …）が両端に来るものは、`Block --acquires--> Generative AI` のように
 * 必ず無意味になるので落とす。
 */
export function isValidRelation(subject: string, relation: string, object: string): boolean {
  const s = (subject ?? '').trim();
  const o = (object ?? '').trim();
  if (!looksLikeEntity(s) || !looksLikeEntity(o)) return false;
  if (isGenericEntity(s) || isGenericEntity(o)) return false;
  if (!(RELATION_TYPES as readonly string[]).includes(relation)) return false;
  if (ORG_ONLY.has(relation) && (isConceptEntity(s) || isConceptEntity(o))) return false;

  const ks = entKey(s);
  const ko = entKey(o);
  if (!ks || !ko || ks === ko) return false;
  if (CONTAINMENT_INVALID.has(relation) && (ks.includes(ko) || ko.includes(ks))) return false;
  return true;
}

/** 対称関係を辞書順に揃える（`A competes_with B` と `B competes_with A` を1本にまとめる） */
export function orderRelation(subject: string, relation: string, object: string): { subject: string; object: string } {
  const s = (subject ?? '').trim();
  const o = (object ?? '').trim();
  if (SYMMETRIC.has(relation) && entKey(o) < entKey(s)) return { subject: o, object: s };
  return { subject: s, object: o };
}

/** UI表示用の日本語ラベル（subject を主語にした能動の言い切り） */
export const RELATION_LABELS: Record<string, string> = {
  outperforms: '性能で上回る',
  competes_with: '競合',
  partners_with: '提携',
  builds_on: '基盤にしている',
  develops: '開発・提供',
  acquires: '買収',
  invests_in: '出資',
  supplies: '供給',
  cites: '引用',
  supersedes: '後継',
};

// ── ベンチマーク ──────────────────────────────────────────────────────
// ベンチマークでないもの。実測で入り込んでいた具体例をそのまま根拠にしている。
const BENCH_SPEC_RE = /(cores?|RAM|メモリ|memory|TOPS|MHz|GHz|\dGB|\dMB|\dKB|nm\b|watt|ワット|price|価格|cost|円|ドル|\$|tokens?\/s|context window|コンテキスト|parameters?|params?|パラメータ)/i;

// 業績・調達・作業量・運用指標。ベンチマークの体裁をしていても比較可能な評価スコアではない。
const BENCH_NOT_SCORE_RE = new RegExp([
  // 業績・資金（実測: `2026年売上高見通し 430億ユーロ` `2026年粗利益率見通し 54%`）
  '売上|収益|利益|粗利|見通し|業績|シェア|資金調達|評価額|株価|時価総額|年収|従業員',
  'revenue|profit|margin|guidance|valuation|funding|market\\s*share|salary|headcount',
  // 作業量（実測: `Commits (Day 1) 11 commits` `Lines of Code 5067 lines` `ADRs (Total) 11`）
  '\\bcommits?\\b|\\bfiles?\\b|lines? of code|\\bLOC\\b|\\bADRs?\\b|pull requests?|\\bissues?\\b',
  // 運用指標（実測: `tok/s` `decode` `token usage` `推論速度`）
  'tok/s|token\\s*usage|throughput|latency|レイテンシ|スループット|推論速度|処理速度|生成速度',
  // 値でないもの（実測: `unknown` `group-128-compatible models`）
  '^unknown$|^n/?a$|不明|該当なし|compatible models',
].join('|'), 'i');

// 日本語の汎用語がベンチ名になっているもの（実測: `コーディング能力` `推論速度` `AIベンチマーク` `GPUカーネル最適化`）
const BENCH_GENERIC_JA_RE = /(能力|速度|効率|最適化|品質|性能|ベンチマーク)$/;

export function isValidBenchmarkName(name: string): boolean {
  const t = (name ?? '').trim();
  if (!t || t.length < 2 || t.length > 50) return false;
  if (BENCH_SPEC_RE.test(t)) return false;
  if (BENCH_NOT_SCORE_RE.test(t)) return false;
  if (BENCH_GENERIC_JA_RE.test(t)) return false;
  // 全部小文字ASCII（`decode` `source-to-result`）は固有のベンチ名ではない。
  // 実在のベンチ名は大文字・数字を含む（MMLU / SWE-bench / ARC-AGI / Terminal-Bench 2.1）。
  if (/^[a-z][a-z\s-]*$/.test(t)) return false;
  return true;
}

/**
 * 単位がベンチスコアとして比較可能か。
 * 実測: `Claude / AIエンジニアリング 52 x` `Claude Opus 5 / Zapier AutomationBench 1.5 times` は
 * 「何かの倍率」であって絶対スコアではないため、リーダーボードに並べると誤読させる。
 */
const BENCH_BAD_UNIT_RE = /^(x|times|倍|commits?|files?|lines?|ADRs?|件|回|分|時間|人|社|ドル|円|ユーロ)$/i;
export function isValidBenchmarkUnit(unit: string | null | undefined): boolean {
  const u = (unit ?? '').trim();
  if (!u) return true; // 単位不明は許容（既存の挙動を変えない）
  return !BENCH_BAD_UNIT_RE.test(u);
}

// ベンチマーク名の表記ゆれを正規化（リーダーボード集約のため）
const BENCH_ALIASES: [RegExp, string][] = [
  [/chatbot\s*arena|lmarena|arena\s*elo/i, 'Chatbot Arena (Elo)'],
  [/mmlu[-\s]?pro/i, 'MMLU-Pro'],
  [/\bmmlu\b/i, 'MMLU'],
  [/gsm[-\s]?8k/i, 'GSM8K'],
  [/swe[-\s]?bench/i, 'SWE-bench'],
  [/human\s*eval/i, 'HumanEval'],
  [/\bmmmu\b/i, 'MMMU'],
  [/\bgpqa\b/i, 'GPQA'],
  [/\baime\b/i, 'AIME'],
  [/arc[-\s]?agi/i, 'ARC-AGI'],
  [/live\s*code\s*bench/i, 'LiveCodeBench'],
  // 2026-09-10 追加: 実測で表記ゆれ重複が出ていたもの
  [/exploit\s*gym/i, 'ExploitGym'],
  [/cyber\s*gym/i, 'CyberGym'],
  [/terminal[-\s]?bench/i, 'Terminal-Bench'],
  [/os\s*world([-\s]?verified)?/i, 'OSWorld-Verified'],
  [/deep\s*swe/i, 'DeepSWE'],
  [/if\s*bench/i, 'IFBench'],
  [/browse\s*comp/i, 'BrowseComp'],
  [/(stanford\s*)?legal\s*bench/i, 'LegalBench'],
];
export function canonicalBenchmarkName(name: string): string {
  const t = (name ?? '').trim();
  for (const [re, canon] of BENCH_ALIASES) if (re.test(t)) return canon;
  return t;
}

// %系ベンチ（accuracy/pass率）。canonicalBenchmarkName の出力名で判定する。
const PERCENT_BENCHMARKS = new Set([
  'MMLU', 'MMLU-Pro', 'GSM8K', 'SWE-bench', 'HumanEval', 'MMMU', 'GPQA', 'AIME', 'ARC-AGI',
  'LiveCodeBench', 'MATH', 'ExploitGym', 'CyberGym', 'Terminal-Bench', 'OSWorld-Verified',
  'DeepSWE', 'IFBench', 'BrowseComp', 'LegalBench',
]);

// ベンチ数値の正規化(D): スケール統一(0.872→87.2)＋物理的にありえない値を弾く。
// 不明なベンチ(正規化名になく unit も不明)は触らない＝保守的。戻り値 null は「異常値→不採用」。
export function normalizeBenchmarkScore(canonName: string, score: number, unit: string | null): number | null {
  if (!Number.isFinite(score)) return null;
  const u = (unit ?? '').toLowerCase();
  // Elo系(Chatbot Arena等)は 0-100 化してはいけない。妥当範囲 500-5000。
  if (/elo|arena/i.test(canonName) || u === 'elo') {
    return score >= 500 && score <= 5000 ? score : null;
  }
  // %系: 既知の%ベンチ、または unit が %。0-1 スケールは ×100 に統一し、0-100 外は異常。
  if (PERCENT_BENCHMARKS.has(canonName) || u === '%' || u === 'percent' || u === 'pct') {
    let s = score;
    // ちょうど 1 は「1位」「1点」「1%」「満点(=100%)」の区別がつかない。
    // 旧実装は無条件に ×100 していたため、本番実測で `Cursor Composer 2.5 / SWE-bench = 100%`
    // `OpenAI / ExploitGym = 100%` という**事実でない断定**を作っていた（CLAUDE.md 第三条）。
    // 曖昧なら捨てる（失敗の非対称性: 誤情報の公開 ＞ 情報の欠落）。
    if (s === 1) return null;
    if (s > 0 && s < 1) s = s * 100;
    if (s < 0 || s > 100) return null;
    return Math.round(s * 10) / 10;
  }
  // 未知でも「〜Bench / 〜Eval」で単位が無く 0<score<1 なら 0-1 スケールの精度とみなす。
  // 実測: `Claude Opus 4.8 / Stanford LegalBench 0.823` が同じ表の `10 %` と並んで意味を成していなかった。
  if (!u && score > 0 && score < 1 && /bench|eval|\bqa\b|accuracy/i.test(canonName)) {
    return Math.round(score * 1000) / 10;
  }
  // 不明: スケール変換せず、負値だけ弾く。
  return score >= 0 ? score : null;
}

// ── クレーム ──────────────────────────────────────────────────────────
// 推測・伝聞。抽出プロンプトでも禁止しているが、実測で `ヤコビ予想の反例を持つ可能性を示唆` が
// 通っていたため、決定論でも落とす（プロンプトの指示は守られない前提で二重化する）。
const SPECULATION_RE = /(かもしれ|可能性が|可能性を|だろう|と思われ|とみられ|見込み|噂|リーク|報じられ|期待され|示唆|likely|rumor|reportedly|allegedly|expected to|is said to)/i;

// 値になっていない値。`= true` は「述語が文で、真偽だけ返した」壊れ方の典型。
const NON_VALUE_RE = /^(true|false|null|none|n\/?a|yes|no|不明|なし|該当なし|はい|いいえ|目標|現在|-|—)$/i;

/**
 * claim として保存してよいか。
 * predicate は「指標名」であるべきで、40字を超えるものは文になっている
 * （実測: `企業の業務フローにAIを組み込みやすい形で提供することで、開発・運用・分析などの領域で自動化を加速させることができる`）。
 */
export function isValidClaim(subject: string, predicate: string, value: string): boolean {
  const s = (subject ?? '').trim();
  const p = (predicate ?? '').trim();
  const v = (value ?? '').trim();
  if (!s || !p || !v) return false;
  if (isGenericEntity(s)) return false;          // `AI / LLMの進化 = LLMは進化しており…`
  if (!looksLikeEntity(s)) return false;
  if (p.length < 2 || p.length > 40) return false;
  if (v.length > 150) return false;
  if (NON_VALUE_RE.test(v)) return false;
  if (entKey(p) && entKey(p) === entKey(v)) return false; // 述語と値が同じ＝情報がない
  if (SPECULATION_RE.test(p) || SPECULATION_RE.test(v)) return false;
  return true;
}
