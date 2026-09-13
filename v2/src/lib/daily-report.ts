// 日次レポート生成の単一実装。サイト掲載・購読者メール・オーナー手動再生成のすべてがここを通る。
// 鮮度の原則: 対象は「前回dailyレポート以降に収集された新着記事」のみ。
// 昨日のレポートで使った記事が重要度順で再登場して新着を押し出す問題を、期間の切り方で構造的に防ぐ。
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { db } from '@/db';
import { collectedData, reports, claims, benchmarks, adoptionLogs } from '@/db/schema';
import { desc, gte, and, lt, eq, count, sql } from 'drizzle-orm';
import { withRetry } from '@/lib/llm';
import { CHARS_PER_MINUTE, readableLength } from '@/lib/reading-time';
import { extractHighlightSection } from '@/lib/digest-highlights';
import { logError } from '@/lib/logError';
import { PRIMARY_SOURCE_HOSTS, MIN_IMPORTANCE, MIN_IMPORTANCE_PRIMARY } from '@/lib/primary-sources';
import { AI_RELEVANT_SQL } from '@/lib/ai-relevance';

// SQLite/libSQL の CURRENT_TIMESTAMP は 'YYYY-MM-DD HH:MM:SS'(空白区切り・UTC)で格納される。
// 比較しきい値はこの形式に揃える（ISOの'T'区切りだと字句比較で境界日がズレる）。
const sqlTs = (d: Date): string => d.toISOString().replace('T', ' ').slice(0, 19);

// 'YYYY-MM-DD HH:MM:SS'(UTC) → epoch ms。パース不能は null。
function parseSqlTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = new Date(s.replace(' ', 'T') + 'Z').getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 朝刊に載せる下限: ★9以上、ただし一次情報源（研究所・モデル提供元）は★8から。 */
const MIN_IMPORTANCE_SQL = sql`(
  ${collectedData.importanceScore} >= ${MIN_IMPORTANCE}
  OR (${collectedData.importanceScore} >= ${MIN_IMPORTANCE_PRIMARY} AND (${sql.join(
    PRIMARY_SOURCE_HOSTS.map(h => sql`LOWER(${collectedData.url}) LIKE ${'%' + h + '%'}`),
    sql` OR `,
  )}))
)`;

/** 候補として引く件数。ここからドメイン上限を掛けて TOP_N まで絞る。 */
const CANDIDATE_LIMIT = 120;
/** レポートの素材として LLM に渡す上限（旧実装の LIMIT 40 と同じ）。 */
const TOP_N = 40;
/** 1ドメインが取れる最大枠。上位20本のうち5本がApple関連という日が実在した（2026-09-10 実測）。 */
const PER_DOMAIN_CAP = 5;

/**
 * セクション別の字数上限。合計 1,800字 = 3分 ＝ **号1本を読み終えるまでの約束そのもの**。
 *
 * ⚠ 2026-09-12 に引き直した。それまでは「ハイライトまで3分／全文7分」という積み上げで、
 *   ハイライト単体は3分に収まっていても**号全体は4分53秒**あった。読者に約束しているのは
 *   「1号を読み終わるまで3分」なので、全文の合計を1,800字に下げる。
 *   （/about の実測表示もハイライトだけを測っていたため 2分25秒 と出て、トップの 4分53秒 と
 *   食い違っていた。表示側は digestReadingSeconds＝号全体に統一済み。）
 *
 * ⚠ この数字は **プロンプトには渡さない**（渡しても効かない。REPORT_SYSTEM_PROMPT のコメント参照）。
 *   長さは構造指定で抑え、ここは生成後の監視にだけ使う。
 *   きっかけ: 2026-09-10 に7日分を実測したところ「全体1500〜2000文字」と指示済みなのに
 *   実際は 4,269〜5,655字（約2.5倍）だった。
 */
export const SECTION_BUDGET = [
  // ⚠ 2026-09-13 に「カテゴリ別トピック(📊) 250字」を廃止し、その枠をハイライトに回した。
  //   理由: 直近21号を実測したところ、📊 の項目がハイライトの見出しと語を共有している割合が
  //   **中央値100%**だった（＝毎号ハイライトの言い直し）。実物でも「Agents API」「京セラ」が
  //   ハイライトと📊の両方に出ていた。読者が同じ話を2回読まされて3分を使っていた。
  { mark: '🔥', name: '今日のハイライト', max: 1350 },
  { mark: '🚀', name: '急上昇トレンド', max: 150 },
  { mark: '💡', name: 'エンジニアへの実践的インサイト', max: 300 },
] as const;

/**
 * 全文の上限＝**3分ちょうど**。表示側と同じ CHARS_PER_MINUTE で数える。
 * ⚠ セクション上限の合計から導かない。セクションを1つ増減させるたびに読者への約束が
 *   勝手に動いてしまうため（📊 を外したとき 1800→1550字＝2.6分に縮む挙動になっていた）。
 */
const TOTAL_BUDGET = 3 * CHARS_PER_MINUTE;

/** ハイライトの必要本数。商品の約束（毎朝5本）そのものなので、生成後に必ず数える。 */
export const REQUIRED_HIGHLIGHTS = 5;

// 読了時間の測り方は表示側（/about）と共通にする（src/lib/reading-time.ts）。
// ここで別実装を持つと「生成側では3分以内、表示側では3分超」というズレが起きる。
export { readableLength } from '@/lib/reading-time';

/** 上限を超えたセクションだけを返す。空配列なら約束を守れている。 */
export function checkBudget(text: string): { name: string; len: number; max: number }[] {
  const over: { name: string; len: number; max: number }[] = [];
  for (const s of SECTION_BUDGET) {
    // '## 🔥 今日のハイライト' のように見出しの先頭で切り出す
    const body = text.split(/^## /m).find(p => p.startsWith(s.mark));
    if (!body) continue;
    const len = readableLength(body);
    if (len > s.max) over.push({ name: s.name, len, max: s.max });
  }
  return over;
}

/**
 * ハイライトの本数を数える。`### 1.` 〜 `### 5.` の見出しの数がそのまま本数。
 *
 * ⚠ プロンプトに「5点」と書いてあっても4本で返ってくる日がある（本人からの指摘・2026-09-12）。
 *   LLMは数を数えられない（[[pattern-llm-cannot-count]]）ので、約束した本数は
 *   **生成後に自分で数える**。ここは判定であって推測ではない。
 */
export function countHighlights(text: string): number {
  const section = extractHighlightSection(text ?? '');
  if (!section) return 0;
  return (section.match(/^###\s+/gm) ?? []).length;
}

/** 超過の一覧を1行のログにする。 */
const fmtOver = (over: { name: string; len: number; max: number }[]): string =>
  over.map(o => `${o.name} ${o.len}/${o.max}字`).join(' / ');


// ─── 生成後の構造強制 ───────────────────────────────────────────
//
// ⚠ **LLMに数えさせない。生成後にこちらが機械的に切る。**
//
// 経緯: REPORT_SYSTEM_PROMPT には最初から「1項目1文」「カテゴリは最大3つ」と書いてあるが、
// 本番14号を実測したところ**13号で全セクションが予算超過**していた（2026-09-13）。
//   今日のハイライト        中央値 2,067字 / 上限 1,100字
//   急上昇トレンド              312字 /   150字
//   カテゴリ別トピック         1,498字 /   250字  ← 6倍
//   エンジニアへのインサイト       887字 /   300字
// 中身を見ると、指定した構造そのものが守られていなかった（各行が2文・カテゴリが4つ・
// 1カテゴリに2項目・インサイトが4項目）。結果、直近21号のうち**20号が3分を超えていた**。
// /about は「3分で読める朝刊」と名乗り、号のページには「9分26秒で読めます」と出ていた。
//
// 字数を突きつけて書き直させる案は既に試して失敗している（455字→486字と悪化・2026-09-10）。
// LLMは字数も項目数も安定して数えられないので、**約束は生成側でなく検査側で守る**。
// → [[pattern-llm-cannot-count]]
//
// 切るのは「プロンプトが元から指定していた数」までであって、新しい制約ではない。
// ハイライトの**本数（5本）だけは絶対に触らない**＝商品の約束そのものなので、
// 足りない場合の再生成（countHighlights）とここは責務を分けてある。

/** 先頭から n 文だけ残す。句点で切り、句点の無い末尾の断片は落とす。 */
export function firstSentences(s: string, n = 1): string {
  const parts = s.match(/[^。]*。/g);
  if (!parts || parts.length === 0) return s.trim();
  return parts.slice(0, n).join('').trim();
}

/** 箇条書き1行を「印＋ラベル」と本文に割る。ラベル（**何が起きたか**:）は残す。 */
const BULLET_RE = /^(\s*[*-]\s+(?:\*\*[^*]+\*\*\s*[:：]\s*)?)([\s\S]*)$/;

function trimBullet(line: string, sentences: number): string {
  const m = line.match(BULLET_RE);
  if (!m) return line;
  const body = firstSentences(m[2], sentences);
  return body ? `${m[1]}${body}` : line;
}

/** セクションごとの上限。すべて REPORT_SYSTEM_PROMPT に既に書いてある数と同じ。 */
const STRUCTURE = {
  '🔥': { bulletSentences: 1 },                                   // 各行1文（本数は触らない）
  '🚀': { paragraphSentences: 2 },                                // 2文
  '📊': { maxBlocks: 3, maxItemsPerBlock: 1, bulletSentences: 1 },// 最大3カテゴリ・1項目1文
  '💡': { maxItems: 3, bulletSentences: 1 },                      // 3項目以内・1項目1文
} as const;

const isBullet = (l: string) => /^\s*[*-]\s+/.test(l);

/**
 * プロンプトで指定済みの構造を、生成結果に対して決定論的に強制する。
 * 入力がどんな形でも例外を投げず、判定できない行はそのまま通す（欠落より冗長）。
 */
export function enforceStructure(text: string): string {
  if (!text?.trim()) return text;
  const out: string[] = [];
  let mark: keyof typeof STRUCTURE | null = null;
  let blocks = 0;          // 📊 の ### の数
  let itemsInBlock = 0;    // 📊 の各 ### 内の項目数
  let items = 0;           // 💡 の項目数
  let dropBlock = false;   // 📊 で上限を超えた ### の中身を捨てる
  let trendSeen = false;   // 🚀 の本文はひとかたまりだけ拾う

  for (const line of text.split('\n')) {
    const h2 = line.match(/^##\s+(\S)/);
    if (h2) {
      mark = (Object.keys(STRUCTURE) as (keyof typeof STRUCTURE)[]).find(k => line.includes(k)) ?? null;
      blocks = 0; itemsInBlock = 0; items = 0; dropBlock = false; trendSeen = false;
      out.push(line);
      continue;
    }
    if (!mark) { out.push(line); continue; }
    const cfg = STRUCTURE[mark];

    if (/^###\s+/.test(line)) {
      if ('maxBlocks' in cfg) {
        blocks++; itemsInBlock = 0;
        dropBlock = blocks > cfg.maxBlocks;
        if (dropBlock) continue;
      }
      out.push(line);
      continue;
    }
    if (dropBlock) continue;

    if (isBullet(line)) {
      if ('maxItemsPerBlock' in cfg) {
        itemsInBlock++;
        if (itemsInBlock > cfg.maxItemsPerBlock) continue;
      }
      if ('maxItems' in cfg) {
        items++;
        if (items > cfg.maxItems) continue;
      }
      out.push('bulletSentences' in cfg ? trimBullet(line, cfg.bulletSentences) : line);
      continue;
    }

    // 箇条書きでない本文（🚀 の段落）
    if ('paragraphSentences' in cfg && line.trim()) {
      if (trendSeen) continue;
      trendSeen = true;
      out.push(firstSentences(line, cfg.paragraphSentences));
      continue;
    }
    out.push(line);
  }
  // 行を落とした結果できた3行以上の空行を詰める
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** `## <印>` で始まるセクションを丸ごと落とす。 */
export function dropSection(text: string, mark: string): string {
  const parts = text.split(/\n(?=##\s)/);
  const kept = parts.filter(p => !p.trimStart().startsWith(`## ${mark}`));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** `## <印>` セクションの箇条書きを先頭 n 項目までにする。 */
export function limitBullets(text: string, mark: string, n: number): string {
  const out: string[] = [];
  let inSec = false, seen = 0;
  for (const line of text.split('\n')) {
    if (/^##\s/.test(line)) { inSec = line.trimStart().startsWith(`## ${mark}`); seen = 0; out.push(line); continue; }
    if (inSec && isBullet(line)) { if (++seen > n) continue; }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * 3分の約束（TOTAL_BUDGET）に収まるまで、**価値の低い順に**構造を落とす。
 *
 * ⚠ ハイライト5本には絶対に触らない。それが商品の約束そのもの。
 *
 * 落とす順番は実測で決めてある（2026-09-13・直近21号）:
 *  1. カテゴリ別トピック … **中央値100%がハイライトの言い直し**だった。
 *     実際、ハイライトに「Agents API」「京セラ」が出た号で、カテゴリ別にも同じ2件が再掲されていた。
 *     いちばん重複が大きいので最初に落とす。
 *  2. 急上昇トレンドを1文に … 元から2文指定。1文でも役目（潮目の提示）は果たす。
 *  3. インサイトを2項目に → 4. インサイトごと → 5. トレンドごと。
 *
 * ここまでやっても収まらない号は、短くする方をあきらめて出す（沈黙より露出）。
 * ただし呼び出し側で必ずログに残す＝気づかないまま長い号が続くのを防ぐ。
 */
export function fitToBudget(text: string): { text: string; steps: string[] } {
  let out = enforceStructure(text);
  const steps: string[] = [];
  const drops: [string, (s: string) => string][] = [
    ['カテゴリ別トピックを落とした（ハイライトの言い直し）', s => dropSection(s, '📊')],
    ['急上昇トレンドを1文にした', s => {
      const lines = s.split('\n'); let inSec = false, done = false;
      return lines.map(l => {
        if (/^##\s/.test(l)) { inSec = l.trimStart().startsWith('## 🚀'); done = false; return l; }
        if (inSec && !done && l.trim() && !isBullet(l)) { done = true; return firstSentences(l, 1); }
        return l;
      }).join('\n');
    }],
    ['インサイトを2項目にした', s => limitBullets(s, '💡', 2)],
    ['インサイトを落とした', s => dropSection(s, '💡')],
    ['急上昇トレンドを落とした', s => dropSection(s, '🚀')],
  ];
  for (const [name, fn] of drops) {
    if (readableLength(out) <= TOTAL_BUDGET) break;
    const next = fn(out);
    if (readableLength(next) < readableLength(out)) { out = next; steps.push(name); }
  }
  return { text: out, steps };
}


/**
 * レポート生成のsystemプロンプト。
 *
 * ⚠ **字数で指示してはいけない**（2026-09-10 に本番データで4回実測）。
 *   - 「1項目360字以内・全体4200字以内」と書いた版 → ハイライト1本455字・全文9分01秒。全セクション超過
 *   - さらに実測値を突きつけて書き直させた版 → 1本486字・9分07秒。**むしろ長くなった**
 *   LLMは文字数を数えられないので、字数の指示は効かないどころか逆効果になる。
 *
 *   一方「文の数・項目の数」は数えられる。構造で縛った版は全文2分44秒まで落ちた。
 *   ただしその版は `### 見出し` が消えて記事タイトルの無い箇条書きになったため、
 *   **落としてほしくない構造は明示的に required と書く**必要がある。
 *
 * 上限の数字（SECTION_BUDGET）はプロンプトには出さず、生成後の checkBudget() の監視にだけ使う。
 *
 * ⚠ 2026-09-13、直近21号の実測で **20/21号が3分を超えていた**（最長 2026-09-04 の9分26秒）。
 *   fitToBudget で機械的に削れば3分には収まるが、その内訳を見ると 12/21号でインサイト節が
 *   丸ごと消えていた＝毎日生成しては捨てていた。長さの原因を構成そのものから取り除く:
 *
 *   1. **「## 📊 カテゴリ別トピック」を廃止**。ハイライトの見出しと語を共有している割合が
 *      中央値100%＝毎号ハイライトの言い直しだった。
 *   2. **ハイライトの「実務への影響」を廃止**（5本で350字/号）。これを外すと
 *      **21/21号が3分以内、かつトレンドもインサイトも全号残る**（1段も削らずに済む）。
 *      中身は「開発者は〜すべきです」という見出しから導ける定型で、5本中4本が
 *      💡インサイト節と1対1で対応していた（2026-09-12号で目視確認）。
 *      ※ bigramの重なり率では 実務26% / なぜ重要か21% / 何が起きたか19% と**分離できなかった**。
 *        この判断の根拠は指標ではなく、対応する行を並べて読んだ結果である。
 *
 *   残した「なぜ重要か」は商品の核（cernere＝選り分ける＋その理由を添える）なので削らない。
 */
export const REPORT_SYSTEM_PROMPT = `あなたはAI技術動向の専門アナリストです。収集データを元に、AIエンジニア・研究者向けのデイリーレポートをMarkdown形式で作成してください。

【必須構成】
## 🔥 今日のハイライト
記事を**ちょうど5点**。4点でも6点でもなく5点。各項目は必ず次の形で書く（### の見出しは省略しない）。

### 1. （記事の見出しを1行で）
*   **何が起きたか**: 1文
*   **なぜ重要か**: 1文

### 2.（以下同じ形で、### 5. まで必ず書く）

## 🚀 急上昇トレンド
2文で書く。ハイライトで挙げた個別の出来事をなぞらず、それらに共通する潮目だけを書く。

## 💡 エンジニアへの実践的インサイト
3項目以内。1項目1文。

【ルール】
- **1文を長くしない。** 読点でつないで1文を伸ばすのは禁止。1文はおよそ50〜70字で終える
- **行数・項目数の指定を超えない。** 書きたいことが多いときは、項目を増やさず優先度の低いものを落とす
- ハイライトの各項目には必ず ### の見出し（その記事のタイトル）を付ける。見出しの無い箇条書きだけの項目は不可
- **ハイライトの ### 見出しは 1. から 5. まで、5つとも必ず出す。**材料が足りないと感じても、関連の薄い記事を5本目に回さず、収集データの中から最も読む価値のあるものを選んで5本にする
- 収集データは前回レポート以降の新着のみ。**前回レポートで既に扱った話題は、新しい進展がある場合だけ「続報」として扱い、単なる繰り返し・焼き直しは禁止**
- **同じ号の中で同じ話を2回書かない。**ハイライトで挙げた出来事を、トレンドやインサイトで言い換えて再掲しない
- 主観でなく客観的な事実ベースで記述
- 絵文字・箇条書きを活用`;

function domainOf(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/**
 * 並び順を保ったまま、1ドメインの本数に上限を掛けて上位 `limit` 件を返す。
 * 上限で弾かれた記事は捨てず、枠が余ったら順に補充する（欠落より冗長を選ぶ）。
 */
export function pickTopWithDomainCap<T extends { url: string | null }>(
  rows: T[], limit = TOP_N, cap = PER_DOMAIN_CAP,
): T[] {
  const used = new Map<string, number>();
  const picked: T[] = [];
  const overflow: T[] = [];
  for (const r of rows) {
    if (picked.length >= limit) break;
    const d = domainOf(r.url);
    const n = used.get(d) ?? 0;
    if (d && n >= cap) { overflow.push(r); continue; }
    used.set(d, n + 1);
    picked.push(r);
  }
  for (const r of overflow) {
    if (picked.length >= limit) break;
    picked.push(r);
  }
  return picked;
}

export interface DailyReportResult {
  inserted: typeof reports.$inferSelect;
  text: string;
}

export async function buildDailyReport(): Promise<DailyReportResult | null> {
  const now = Date.now();

  // 前回のdailyレポート（新着期間の起点＋「繰り返し禁止」の比較対象）
  const [prevDaily] = await db.select({
    content: reports.content, createdAt: reports.createdAt, reportDate: reports.reportDate,
  })
    .from(reports)
    .where(and(eq(reports.type, 'daily'), sql`length(${reports.content}) > 0`))
    .orderBy(desc(reports.createdAt))
    .limit(1);

  // 新着期間 = 前回daily生成時刻以降。ただし 20〜48時間に収める:
  // - 下限20h: 手動再生成の直後でも直近1日分は対象に残す
  // - 上限48h: パイプライン停止明けでも古い記事でレポートが埋まらない
  const prevMs = parseSqlTs(prevDaily?.createdAt);
  const sinceMs = prevMs != null
    ? Math.max(now - 48 * 3_600_000, Math.min(prevMs, now - 20 * 3_600_000))
    : now - 24 * 3_600_000;
  const since = sqlTs(new Date(sinceMs));
  const sevenDaysAgo = sqlTs(new Date(now - 7 * 86_400_000));
  const fourteenDaysAgo = sqlTs(new Date(now - 14 * 86_400_000));

  const [rawRecent, thisWeekCounts, lastWeekCounts, recentClaims, recentBench] = await Promise.all([
    // 新着記事のみ（重要度順は新着期間の中だけで適用）。
    //
    // ⚠️ 第2ソートキーが `created_at DESC` だった間、選別は実質「クロール挿入時刻」で決まっていた。
    // importance_score は整数7値で86.8%が4値に集中し、1日約230本が流入するので、LIMIT 40 の
    // 切断面は必ず同点の塊の内部に落ちる（過去21日で例外なし）。直近14日の同点帯1,005本のうち
    // 445本(44.3%)が「同じスコアなのに」脱落し、採用率に startupfortune 67% / TechCrunch 43% の
    // ような差が出ていた。しかも新しい記事ほど本文が未取得なので、
    // **最も情報を持たない記事を最優先で選ぶ**状態になっていた（2026-09-10 監査）。
    //
    // 同点を解くのは以下の順。いずれも既にDBにある量で、LLMもコストも増やさない:
    //   1. story_count      何本の報道が同じ出来事を扱ったか＝注目度の実測値
    //   2. 本文の有無        読んでいない記事より読んだ記事を上に
    //   3. published_at     クロール時刻ではなく実際の公開時刻
    //   4. id               最後の決定論的な綱引き（実行ごとに順序が変わらないように）
    // ドメイン上限は下の pickTop40 で掛ける（1社が枠を占拠しないように）。
    //
    // 2026-09-12: 候補を「★9以上（一次情報源は★8から）」に限定した。
    //
    // ゲート前の上位40枠は94%が★9以上だったので当初「現状追認」と判断したが、実測すると違った。
    // 当時★9の枠を埋めていたうちの30%はノイズ源（startupfortune 等）で、それを同時に止めたため、
    // ★9以上の実数は1日22〜59本（14日測定・中央値およそ35本）になる。つまり TOP_N=40 は
    // 埋まらない日の方が多く、残り枠に★8/★7が滑り込んでいた分がそのまま消える＝これは実質的な変更。
    //
    // それでも構わないのは、この40件は「LLMに渡す材料」であって載せる本数ではないから。
    // 約束しているハイライトは5本で、最も薄い日でも22本あり4倍以上の余裕がある。
    // 材料を増やすより、★7を混ぜない方が紙面は良くなる（本人の指示・2026-09-12）。
    // 一次情報源の救済（★8から拾う・実測2.1本/日）の理由は src/lib/primary-sources.ts を参照。
    // ⚠ AI関連度もここで見る。importance だけで絞っていた頃、「新潟駅徒歩圏で完結する
    //    1泊2日観光モデルルート」★9 がこの候補プールに入っていた（2026-09-12 実測）。
    //    収集側にもゲートを置いたが、それ以前に集めた記事が残っているのでここでも落とす。
    //    NULL（未判定・本文が取れずLLMに通せなかったHN記事）は落とさない。→ src/lib/ai-relevance.ts
    // ⚠ 落とすのは **0（AIと無関係と明示判定されたもの）だけ**。判定はぶれるので 4 で切ってはいけない
    //    （スコア3にNVIDIA Cosmosや Claude Code が入っていた／実測の詳細は ai-relevance.ts）。
    //    ここは公開面と違い、外しても記事はサイトに残り検索にも出る＝回復可能なので掛けてよい。
    db.select().from(collectedData)
      .where(and(gte(collectedData.createdAt, since), MIN_IMPORTANCE_SQL, AI_RELEVANT_SQL))
      .orderBy(
        desc(collectedData.importanceScore),
        desc(sql`COALESCE(${collectedData.storyCount}, 1)`),
        desc(sql`CASE WHEN ${collectedData.rawContent} IS NOT NULL AND LENGTH(${collectedData.rawContent}) > 200 THEN 1 ELSE 0 END`),
        desc(sql`COALESCE(${collectedData.publishedAt}, ${collectedData.createdAt})`),
        desc(collectedData.id),
      )
      .limit(CANDIDATE_LIMIT),
    // カテゴリ別トレンドは文脈情報なので週次窓のまま
    db.select({ category: collectedData.category, cnt: count() })
      .from(collectedData).where(gte(collectedData.createdAt, sevenDaysAgo)).groupBy(collectedData.category),
    db.select({ category: collectedData.category, cnt: count() })
      .from(collectedData)
      .where(and(gte(collectedData.createdAt, fourteenDaysAgo), lt(collectedData.createdAt, sevenDaysAgo)))
      .groupBy(collectedData.category),
    // 根拠となる事実・数値も新着分のみ（古い事実で昨日の話題を再構成させない）
    db.select({ subject: claims.subject, predicate: claims.predicate, value: claims.value })
      .from(claims)
      .where(and(eq(claims.status, 'active'), gte(claims.createdAt, since)))
      .orderBy(desc(claims.createdAt)).limit(12),
    db.select({ entityName: benchmarks.entityName, benchmarkName: benchmarks.benchmarkName, score: benchmarks.score, unit: benchmarks.unit })
      .from(benchmarks).where(gte(benchmarks.createdAt, since)).orderBy(desc(benchmarks.createdAt)).limit(12),
  ]);

  if (rawRecent.length === 0) return null;

  // 1社が朝刊を占拠しないようにドメイン上限を掛けてから上位40件に絞る
  const topRecent = pickTopWithDomainCap(rawRecent, TOP_N, PER_DOMAIN_CAP);

  // 重複ストーリーを代表1件に集約
  const seenStory = new Set<number>();
  const recentData: typeof rawRecent = [];
  for (const d of topRecent) {
    if (d.storyId != null) { if (seenStory.has(d.storyId)) continue; seenStory.add(d.storyId); }
    recentData.push(d);
    if (recentData.length >= 15) break;
  }

  const contextStr = recentData
    .map(d => {
      // storyCountは「同一ストーリーの記事数」であって媒体数ではない（実測: 160件のstoryでも実媒体は6）。
      // 「N媒体が報じた」と書くとLLMがその誇張をそのままレポートに載せるため、件数として渡す。
      const multi = (d.storyCount ?? 1) > 1 ? `（同一トピックで${d.storyCount}件）` : '';
      return `[重要度:${d.importanceScore ?? 5}/10][${d.category ?? '未分類'}]${multi} ${d.titleJa || d.title}\n${d.summary}\nURL: ${d.url}\n公開日: ${d.publishedAt?.split('T')[0] ?? '不明'}`;
    })
    .join('\n\n---\n\n');

  const evidenceLines = [
    ...recentClaims.map(c => `- ${c.subject}: ${c.predicate} = ${c.value}`),
    ...recentBench.map(b => `- ${b.entityName} / ${b.benchmarkName}: ${b.score}${b.unit ?? ''}`),
  ];
  // ⚠️ 以前はここを【検証済みの事実・数値（根拠として引用してよい）】と称していた。中身は
  // arXiv 論文のアブストラクトから抜いた**著者の自己申告**（例:「自己進化により手動エンジニアリング
  // なしで性能が向上する|True」）で、検証されたものではない。その結果 2026-09-10 配信のレポートに
  //「（検証済みデータ：処理可能なモダリティ = 医療画像…）」のような表現が実際に出ていた。
  // confidence も 91.7% が 'high' の定数で、真偽の情報を持っていない（2026-09-10 監査）。
  const evidenceText = evidenceLines.length > 0
    ? '\n\n【記事から抽出した記述・未検証（発表者側の主張。「検証済み」と書かないこと。引用する場合は誰の主張かを明示する）】\n'
      + evidenceLines.join('\n')
    : '';

  const lastWeekMap = new Map(lastWeekCounts.map(r => [r.category, Number(r.cnt)]));
  const trendLines = thisWeekCounts
    .map(r => ({ cat: r.category ?? 'その他', now: Number(r.cnt), prev: lastWeekMap.get(r.category ?? '') ?? 0 }))
    .filter(r => r.now >= 2)
    .map(r => ({ ...r, ratio: r.prev === 0 ? r.now * 2 : r.now / r.prev }))
    .sort((a, b) => b.ratio - a.ratio).slice(0, 5)
    .map(r => `${r.cat}: 今週${r.now}件/先週${r.prev}件${r.ratio >= 2 ? ' 🚀急上昇' : r.ratio >= 1.3 ? ' ↑上昇' : r.ratio <= 0.7 ? ' ↓減少' : ''}`);
  const trendText = trendLines.length > 0 ? '\n\n【カテゴリ別週次トレンド（参考データ）】\n' + trendLines.join('\n') : '';

  // 前回レポート: 「既報の焼き直し禁止」の判定材料として渡す
  const prevSection = prevDaily?.content
    ? `\n\n【前回のレポート（${prevDaily.reportDate}・重複回避用）】\n${prevDaily.content.slice(0, 1200)}`
    : '';

  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });

  const model = google('gemini-2.5-flash');
  const system = REPORT_SYSTEM_PROMPT;

  const userPrompt = `今日の日付: ${today}${trendText}${evidenceText}${prevSection}\n\n【新着の収集データ（重要度順・${recentData.length}件）】\n${contextStr}`;

  let text = (await withRetry(() => generateText({ model, system, prompt: userPrompt }))).text;

  // ── ハイライトが5本あるか（商品の約束）──
  // 足りなければ**1回だけ**引き直す。字数と違って「本数」はLLMも数えられる形の指示なので、
  // 不足を具体的に伝える再生成には意味がある（字数の再指示は逆効果だった。下のコメント参照）。
  // 2回目も足りなければ、短い号を出す方を選ぶ（欠落より冗長、ではなく**沈黙より露出**）。
  // そのうえで必ず通知する＝気づかないまま4本の日が続くのを防ぐ。
  let highlights = countHighlights(text);
  if (text?.trim() && highlights < REQUIRED_HIGHLIGHTS) {
    console.warn(`[Report] ハイライトが${highlights}本しかない → 1回だけ再生成する`);
    const retryPrompt = userPrompt
      + `\n\n【やり直しの指示】前回の出力は「## 🔥 今日のハイライト」の ### 見出しが${highlights}個しかありませんでした。`
      + `### 1. から ### ${REQUIRED_HIGHLIGHTS}. まで、${REQUIRED_HIGHLIGHTS}個すべて出力してください。他の構成は同じで構いません。`;
    try {
      const retry = (await withRetry(() => generateText({ model, system, prompt: retryPrompt }))).text;
      const n = countHighlights(retry);
      if (retry?.trim() && n > highlights) { text = retry; highlights = n; }
    } catch (e) {
      console.warn('[Report] 再生成に失敗（元の出力をそのまま使う）:', e);
    }
  }
  if (text?.trim() && highlights < REQUIRED_HIGHLIGHTS) {
    await logError(
      'daily-report highlights',
      new Error(`今朝の朝刊のハイライトが ${highlights}/${REQUIRED_HIGHLIGHTS} 本です（再生成しても揃いませんでした）`),
      { alert: true },
    );
  }

  // ── 3分の約束を機械的に守らせる ──
  // プロンプトの構造指定（1項目1文・インサイト3項目以内）は守られないので、生成後にこちらで切る。
  // APIは叩かない＝コスト増ゼロ。詳細は enforceStructure / fitToBudget のコメント。
  // ⚠ ハイライトの本数には触らない（上の再生成が担当）。
  if (text?.trim()) {
    const before = readableLength(text);
    const { text: shaped, steps } = fitToBudget(text);
    const after = readableLength(shaped);
    // 短くなった場合だけ採用する。万一の解析ミスで中身が増えたり消えたりしたらそのまま出す。
    if (shaped.trim() && after > 0 && after <= before && countHighlights(shaped) === highlights) {
      if (after < before) {
        console.log(
          `[Report] 3分に収める: ${before}字 → ${after}字`
          + (steps.length ? `（${steps.join(' / ')}）` : ''),
        );
      }
      text = shaped;
    } else {
      console.warn(`[Report] 構造の強制を見送った（${before}字 → ${after}字 / ハイライト ${countHighlights(shaped)}本）`);
    }
  }

  // 長さは REPORT_SYSTEM_PROMPT の構造指定で抑える。ここでは**測るだけ**で書き直させない。
  //
  // ⚠ 一度は「超過したら実測値を渡して書き直させる」を実装したが、本番データで測ったら
  //   ハイライト1本 455字 → 486字 と**悪化した**（2026-09-10）。字数を突きつけても
  //   LLMは字数を数えられないので効かない。毎日1回APIを余計に叩いて悪くするだけなので外した。
  //   構造指定が効かなくなったらこのログで気づけるようにしておく（沈黙して伸びるのを防ぐ）。
  if (text?.trim()) {
    const total = readableLength(text);
    const over = checkBudget(text);
    // 読者への約束は**全文3分**なので、セクション別が全部収まっていても合計が超えたら警告する。
    // fitToBudget が落とせるものを全部落としてもなお超える＝ハイライト5本だけで3分を食っている状態。
    if (total > TOTAL_BUDGET || over.length > 0) {
      console.warn(
        `[Report] 読了時間が予算超過: ${over.length ? fmtOver(over) : '全文'}`
        + `（全文 ${total}字 ≒ ${(total / CHARS_PER_MINUTE).toFixed(1)}分 / 上限 ${TOTAL_BUDGET}字 = ${TOTAL_BUDGET / CHARS_PER_MINUTE}分）。`
        + 'プロンプトの構造指定が効かなくなっている可能性があります。',
      );
    }
  }

  // LLMが空応答を返すことがある。空レポートを最新dailyとして保存すると購読者メールのダイジェストが消えるため、保存せずnullを返す。
  if (!text?.trim()) { console.warn('[Report] 空レポートのため保存をスキップ'); return null; }

  const reportDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const [inserted] = await db.insert(reports).values({ type: 'daily', content: text, reportDate }).returning();

  // 採用ログ（ソーススコアの根拠）
  const adoptedSourceIds = [...new Set(recentData.map(d => d.sourceId).filter((v): v is number => v != null))];
  if (inserted?.id && adoptedSourceIds.length > 0) {
    await db.insert(adoptionLogs).values(adoptedSourceIds.map(sourceId => ({ reportId: inserted.id, sourceId, isAdopted: 1 as const })));
  }

  return { inserted, text };
}
