import { readingSeconds } from '@/lib/reading-time';

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

/** Markdownの強調記号を落として本文だけにする。 */
function cleanText(raw: string): string {
  return raw.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

/** レポート本文から「今日のハイライト」セクションの生Markdownを取り出す。無ければ null。 */
export function extractHighlightSection(markdown: string): string | null {
  if (!markdown) return null;
  const section = markdown.split(/^## /m).find(p => p.trimStart().startsWith(HIGHLIGHT_MARK));
  return section ?? null;
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
      // "*   **何が起きたか**: 本文" / "- **なぜ重要か**：本文"
      const m = line.match(/^\s*[*\-+]\s+\*\*(.+?)\*\*\s*[:：]\s*(.+)$/);
      if (m) points.push({ label: cleanText(m[1]), text: cleanText(m[2]) });
    }
    out.push({ title, points });
  }
  return out;
}

/** ハイライトだけを読むのに要する秒数（＝商品が約束している「3分」の実測値）。 */
export function highlightsReadingSeconds(markdown: string): number {
  const section = extractHighlightSection(markdown);
  return section ? readingSeconds(section) : 0;
}
