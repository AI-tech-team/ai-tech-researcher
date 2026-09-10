/**
 * 読了時間の計算。商品の約束（「忙しい人でも3分でAI動向を知れる」）を数値にする唯一の場所。
 *
 * ここを1か所に固定するのは、生成側（daily-report.ts の予算監視）と表示側（/about の「◯分で読めます」）で
 * 測り方がずれると、**約束を守れていないのに守れているように見える**ため。
 */

/** 日本語の黙読速度の前提。3分＝1,800字はここから決まる（本人指定・2026-09-11）。 */
export const CHARS_PER_MINUTE = 600;

/**
 * 読者が実際に読む字数。Markdownの記号と余分な空白は読まないので数えない。
 * 絵文字はサロゲートペアで2カウントになるが、読む「間」はあるので除外しない。
 */
export function readableLength(s: string): number {
  return s.replace(/[#*`\-_>|]/g, '').replace(/\s+/g, ' ').trim().length;
}

/** 読了に要する秒数。 */
export function readingSeconds(s: string): number {
  return Math.round((readableLength(s) / CHARS_PER_MINUTE) * 60);
}

/** 「2分38秒」の形に。0分台でも「0分38秒」ではなく「38秒」にする。 */
export function formatReadingTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m === 0 ? `${s}秒` : `${m}分${String(s).padStart(2, '0')}秒`;
}
