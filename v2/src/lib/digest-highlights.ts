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
      const li = line.match(/^\s*[*\-+]\s+(.+)$/);
      if (!li) continue;
      const body = li[1];
      // ラベル付き。コロンが**太字の内側**にある古い形にも合わせる。
      //   新: "*   **何が起きたか**: 本文"（2026-09-10 のプロンプト改訂以降）
      //   旧: "*   **何が起きたか:** 本文"（それ以前の全レポート＝バックナンバー）
      // 旧形を落としていたため、過去の号は見出しだけが並んで本文が消えていた（2026-09-11 実機で発見）。
      const lab = body.match(/^\*\*\s*(.+?)\s*[:：]\s*\*\*\s*(.+)$/)
        ?? body.match(/^\*\*\s*(.+?)\s*\*\*\s*[:：]\s*(.+)$/);
      // コロンを要求するのは、`**Show-Harness**は…` のような文中の強調をラベルと誤認しないため。
      if (lab) points.push({ label: cleanText(lab[1]), text: cleanText(lab[2]) });
      else points.push({ label: '', text: cleanText(body) });
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
