import { parseHighlights, cleanText, type Highlight } from './digest-highlights';
import { readingSeconds } from './reading-time';

/**
 * 日次レポート（Markdown）を紙面として組むための構造に開く。
 *
 * なぜ既存の `renderMarkdown`（components/Markdown.tsx）を使わないか:
 *   あれは Tailwind のクラスを直に埋める**クライアント**コンポーネントで、色は globals.css の
 *   テーマ変数に紐づいている。朝刊の紙面は黒白のバンドという別の視覚世界（/about と同じ語彙）なので、
 *   表示側で色を当て直す必要がある。ここでは**構造だけ**返し、色と書体は紙面側が決める。
 *
 * ハイライトの分解は [[digest-highlights]] の実装をそのまま使う（二重実装を作らない）。
 *
 * ⚠ セクション名・絵文字を決め打ちにしない。生成側（daily-report.ts の REPORT_SYSTEM_PROMPT）が
 *   変わったときにここが黙って空になるのを避けるため、`## ` で割って出てきたものを順に持つ。
 *   週次・月次レポートはハイライトの形を持たないが、同じ関数で「見出し＋段落＋箇条書き」として開ける。
 */

export type DigestBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'group'; title: string; items: string[] };

export type DigestSection = { mark: string; title: string; blocks: DigestBlock[] };

export type ParsedDigest = {
  /** 前書き（`## ` より前）。宛名の挨拶行は落とす。 */
  lead: string[];
  /** 🔥 今日のハイライト。 */
  highlights: Highlight[];
  /** ハイライト以外のセクション（出現順）。 */
  sections: DigestSection[];
};

/** 「AIエンジニア・研究者の皆様へ」のようなメール文の宛名。紙面の1行目には要らない。 */
const SALUTATION = /(?:皆様|皆さま|皆さん|各位)\s*へ?\s*$/;

/** 区切り線（`---` `***` `___`）。 */
const HR = /^([-*_])\1{2,}$/;

/** 本文の整形は [[digest-highlights]] の cleanText に寄せる（内部IDの除去もそちらで一括）。 */
const clean = cleanText;

/** セクション見出しを「絵文字」と「文字」に割る。絵文字が無ければ mark は空。 */
function splitHeading(raw: string): { mark: string; title: string } {
  const m = raw.match(/^([\p{Extended_Pictographic}\u{FE0F}\u{200D}]+)\s*(.*)$/u);
  return m ? { mark: m[1].trim(), title: clean(m[2]) } : { mark: '', title: clean(raw) };
}

/** セクション本文を段落・箇条書き・`### 小見出し` の塊に開く。 */
function parseBlocks(lines: string[]): DigestBlock[] {
  const blocks: DigestBlock[] = [];
  let group: { title: string; items: string[] } | null = null;
  let list: string[] | null = null;

  const flushList = () => {
    if (list && list.length) {
      if (group) group.items.push(...list);
      else blocks.push({ kind: 'list', items: list });
    }
    list = null;
  };
  const flushGroup = () => {
    flushList();
    if (group) { blocks.push({ kind: 'group', title: group.title, items: group.items }); group = null; }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || HR.test(line)) { flushList(); continue; }

    const h3 = line.match(/^#{3,}\s+(.*)$/);
    if (h3) { flushGroup(); group = { title: splitHeading(h3[1]).title, items: [] }; continue; }

    const li = line.match(/^[*\-+]\s+(.*)$/);
    if (li) { (list ??= []).push(clean(li[1])); continue; }

    flushList();
    const text = clean(line);
    if (!text) continue;
    if (group) group.items.push(text);
    else blocks.push({ kind: 'p', text });
  }
  flushGroup();
  return blocks;
}

/** レポート本文を紙面用の構造に開く。形が崩れていても取れた分だけ返す。 */
export function parseDigest(markdown: string): ParsedDigest {
  if (!markdown) return { lead: [], highlights: [], sections: [] };

  const parts = markdown.split(/^## /m);
  const lead = (parts[0] ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !HR.test(l) && !SALUTATION.test(l) && !l.startsWith('#'))
    .map(clean)
    .filter(Boolean);

  const highlights = parseHighlights(markdown);

  const sections: DigestSection[] = [];
  for (const part of parts.slice(1)) {
    const lines = part.split('\n');
    const { mark, title } = splitHeading(lines[0] ?? '');
    if (!title && !mark) continue;
    // ハイライトは highlights として別に返しているので二重に出さない。
    // ただし分解に失敗している（＝形が崩れている）ときは、生の塊として出す方がマシ。
    const isHighlights = highlights.length > 0 && /ハイライト/.test(title);
    if (isHighlights) continue;
    const blocks = parseBlocks(lines.slice(1));
    if (blocks.length) sections.push({ mark, title, blocks });
  }

  return { lead, highlights, sections };
}

/** 朝刊1号を読み終えるまでの秒数（600字/分・[[reading-time]] と同じ測り方）。 */
export function digestReadingSeconds(markdown: string): number {
  return readingSeconds(markdown ?? '');
}

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 号の日付を「2026年9月11日（金）」にする。
 *
 * ⚠ `new Date('2026-09-11')` はUTCの深夜として解釈されるので、実行環境のタイムゾーン（Vercelは UTC、
 *   手元は JST）によって曜日が1日ずれる。日付文字列を桁で読んで UTC で曜日を出し、環境に依存させない。
 */
export function formatIssueDate(reportDate: string | null | undefined): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(reportDate ?? '').trim());
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const w = WEEKDAY[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${y}年${mo}月${d}日（${w}）`;
}
