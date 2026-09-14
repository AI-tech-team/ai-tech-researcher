
/**
 * 日次レポート（Markdown）から「今日のハイライト」だけを構造化して取り出す。
 *
 * 用途は紹介ページ（/about）。商品の約束は「3分で今朝のAI動向がわかる」で、その3分の中身が
 * ハイライト5本にあたる。説明文を書く代わりに**今朝の実物をそのまま読ませる**ため、
 * 見出し・3項目の形に戻す必要がある。
 *
 * 生成側の形は daily-report.ts の REPORT_SYSTEM_PROMPT が決めている:
 *   ## 🔥 今日のハイライト
 *   ### 1. 記事の見出し
 *   *   **何が起きたか**: ...
 *   *   **なぜ重要か**: ...
 *   *   **実務への影響**: ...
 *
 * ⚠ ラベル名は決め打ちにしない。生成側の文言を変えたときにここが黙って空になるのを避けるため、
 *   `**ラベル**:` の形だけを見て中身をそのまま持つ。
 */

import { bulletContent } from './markdown-lines';

export type HighlightPoint = { label: string; text: string };
export type Highlight = { title: string; points: HighlightPoint[] };

/** 「今日のハイライト」セクションの目印。生成側の SECTION_BUDGET と同じ絵文字。 */
const HIGHLIGHT_MARK = '🔥';

/** 見出し先頭の連番（"1. " "２．"）と装飾の絵文字を落とす。 */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^\s*[0-9０-９]+\s*[.．、]\s*/, '')
    // 先頭の絵文字は紙面の装飾。見出しの意味を持たないので落とす（デザイン上の判断）
    .replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '')
    .replace(/\*\*/g, '')
    .trim();
}

/**
 * 読者が読む本文だけにする。Markdownの強調記号と、本文に混じる内部IDの参照を落とす。
 *
 * 内部IDは `（ID:4201, 4040）` `[ID:4189]` の形で古いレポートの文末に入っている
 * （生成時に収集データの行番号をそのまま書かせていた名残）。読者には意味が無いうえ、
 * 数字が記事番号に見えるので落とす。**リンクにはしない**: このIDは当時のDBの行を指していて、
 * 今の記事IDと一致する保証が無く、誤ったリンクは欠落より悪い（失敗の非対称性）。
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\*\*/g, '')
    // ⚠ 紙面（トップの朝刊・/about）はインライン装飾を持たない黒白のバンドなので、
    //   `**` を落とすのと同じ理由でコード記法とリンク記法も**中身だけ**にする。
    //   落とさないと読者には記号がそのまま見える。実測（backup_2026-09-13・公開142号）:
    //   バッククォートは **13号・56本**（最後は 2026-09-04＝現行）、リンクは1号・10本（2026-05-18）。
    //   記事本文ページ（components/Markdown.tsx）は<code>や<a>にするので、そちらとは意図的に別。
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s*[（([]\s*ID\s*[:：][\d,\s]*\d\s*[）)\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** レポート本文から「今日のハイライト」セクションの生Markdownを取り出す。無ければ null。 */
export function extractHighlightSection(markdown: string): string | null {
  if (!markdown) return null;
  const section = markdown.split(/^## /m).find(p => p.trimStart().startsWith(HIGHLIGHT_MARK));
  return section ?? null;
}

/**
 * 箇条書きでない「続きの行」を要点として読んでよいか。
 *
 * ⚠ これが要る理由（2026-09-15・公開142号で実測）: 見出しは出るのに**要点が1本も無い**号が3号あった。
 *   紙面には見出しだけが並び、本文が丸ごと消えていた（失敗が部分的でなく全体的）。原因は生成側の形:
 *     形1（2026-05-21 / 05-22）: `### 1. 見出し` の下に**箇条書き記号なし**の `**何が起きたか:** 本文`
 *     形2（id=90・2026-06-11の再生成版）: `*   **見出し**` の下に**字下げした素の本文**
 *   どちらも「箇条書き行だけを要点にする」規則から外れて落ちていた。記号の有無で本文を捨てない。
 *   落とすのは見出し・区切り線・空行だけ。→ 33号を救った parseBulletHighlights と同じ話の続きで、
 *   「1本見つけたら同型を全部当たる」の実践（pattern-positional-pairing と同じ教訓）。
 */
function isBodyLine(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  if (/^#{1,6}\s/.test(s)) return false;        // 見出し
  if (/^([-*_])\1{2,}$/.test(s)) return false;  // 区切り線（--- *** ___）
  return true;
}

/**
 * 1項目の要点行を読む。ラベル付き（`**何が起きたか**: 本文`）とそうでない行の両方を扱う。
 * コロンを要求するのは、`**Show-Harness**は…` のような文中の強調をラベルと誤認しないため。
 * ラベル名は決め打ちにしない（生成側の文言が変わってもここが黙って空にならないように）。
 */
function toPoint(body: string): HighlightPoint {
  //   新: "*   **何が起きたか**: 本文"（2026-09-10 のプロンプト改訂以降）
  //   旧: "*   **何が起きたか:** 本文"（それ以前の全レポート＝バックナンバー）
  //   旧形を落としていたため、過去の号は見出しだけが並んで本文が消えていた（2026-09-11 実機で発見）。
  const lab = body.match(/^\*\*\s*(.+?)\s*[:：]\s*\*\*\s*(.+)$/)
    ?? body.match(/^\*\*\s*(.+?)\s*\*\*\s*[:：]\s*(.+)$/);
  return lab ? { label: cleanText(lab[1]), text: cleanText(lab[2]) } : { label: '', text: cleanText(body) };
}

/**
 * `### ` で割れない号のための後方互換。行頭の箇条書きを1本、字下げした箇条書きをその要点として読む。
 *
 * ⚠ これが要る理由（2026-09-15 実測）: 🔥節は**あるのに 0本**になる daily が **33号 / 121号**あった
 *   （2026-05-28〜2026-07-07）。当時の生成側は各ハイライトを `### ` ではなく
 *   `*   **見出し**` の箇条書きで出していた。0本になるとトップも過去号ページも
 *   紙面の組みを失い、生の塊に落ちる＝**失敗が部分的でなく全体的**。
 *   しかも 🔥 の構造ゲート（daily-report.ts の STRUCTURE）は本数と文数しか見ておらず、
 *   **見出しレベルを強制していない**ので、生成側が戻ればいつでも再発する。
 *   行の判定は markdown-lines.ts に寄せる（同じ規則のコピーを増やさない）。
 */
function parseBulletHighlights(section: string): Highlight[] {
  const out: Highlight[] = [];
  let cur: Highlight | null = null;
  for (const line of section.split('\n').slice(1)) {
    const body = bulletContent(line);
    if (body === null) {
      // 記号を付けず字下げだけで続きを書く号があった（id=90）。字下げは「直前の項目の続き」の
      // 意思表示なので本文として拾う。字下げの無い素の行は前書き等なので拾わない。
      if (cur && /^[ \t]/.test(line) && isBodyLine(line)) cur.points.push(toPoint(line.trim()));
      continue;
    }
    if (/^[ \t]/.test(line)) { cur?.points.push(toPoint(body)); continue; }
    const title = cleanTitle(body);
    if (!title) { cur = null; continue; }
    cur = { title, points: [] };
    out.push(cur);
  }
  return out;
}

/** ハイライト5本を構造化して返す。形が崩れていれば取れた分だけ返す（空配列もありうる）。 */
export function parseHighlights(markdown: string): Highlight[] {
  const section = extractHighlightSection(markdown);
  if (!section) return [];

  const out: Highlight[] = [];
  // '### ' で項目に割る。先頭要素はセクション見出しなので捨てる。
  for (const block of section.split(/^### /m).slice(1)) {
    const lines = block.split('\n');
    const title = cleanTitle(lines[0] ?? '');
    if (!title) continue;
    const points: HighlightPoint[] = [];
    for (const line of lines.slice(1)) {
      const body = bulletContent(line);
      if (body !== null) { points.push(toPoint(body)); continue; }
      // 記号を付けずに `**何が起きたか:** 本文` を並べる号があった（2026-05-21 / 05-22）。→ isBodyLine
      if (isBodyLine(line)) points.push(toPoint(line.trim()));
    }
    out.push({ title, points });
  }
  // `### ` が1本も取れない号は、箇条書き形式の旧レイアウトとして読み直す。
  return out.length > 0 ? out : parseBulletHighlights(section);
}

/**
 * 「既報の焼き直し禁止」をLLMに判定させるための材料を作る。
 *
 * ⚠ なぜ見出しだけを渡すか（2026-09-15・backup_2026-09-13 で実測）:
 *   それまでは前回レポートの**本文を先頭から1,200字**切って渡していた。だが本文は
 *   **中央値5,690字**あるので、**全83号401本のうち169本（42.1%）が最初から見えていなかった**。
 *   実害も確認できた: 09-12 の5本目「OpenAIのナビエ・ストークス方程式解決に不正疑惑」は
 *   1,200字の外側にあり、翌09-13 に「OpenAIの数学ブレークスルーが未発表データ利用で論争に」として
 *   **1本目に返り咲いた**（同じ話が 09-09 → 09-12 → 09-13 と3号に出ている）。
 *   見出しだけなら1号あたり約200字＝**全部見えて、しかも字数は減る**。
 *
 * ⚠ 直近1号では足りない: 上の例は 09-09 と 09-12 が3日離れており、
 *   「前の号」しか見ない限り構造的に検出できない。数号ぶん渡す。
 *
 * 字数上限に当たったら**古い号から丸ごと落とす**。途中で切ると、そこだけ見出しが欠けて
 * 「見えていたのに見落とした」のか「そもそも渡していない」のかが後から分けられなくなる。
 */
export function buildRehashGuard(
  editions: { reportDate: string | null; content: string | null }[],
  maxChars = 1200,
): string {
  const blocks: string[] = [];
  let used = 0;
  for (const e of editions) {
    const titles = parseHighlights(e.content ?? '').map(h => h.title).filter(t => t.length > 0);
    if (titles.length === 0) continue;
    const block = `${e.reportDate ?? '（日付不明）'}:\n${titles.map(t => `- ${t}`).join('\n')}`;
    if (used > 0 && used + block.length + 1 > maxChars) break; // 新しい号は必ず丸ごと残す
    blocks.push(block);
    used += block.length + 1;
  }
  if (blocks.length === 0) return '';
  return `\n\n【直近のレポートで既に扱った見出し（重複回避用・新しい順）】\n${blocks.join('\n')}`;
}
