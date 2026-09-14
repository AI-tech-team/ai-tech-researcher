/**
 * 朝刊メール用の Markdown → 明色インラインHTML 変換。
 *
 * ⚠ これが `daily_pipeline.ts` の中から出てきた理由（2026-09-15）:
 *
 * この変換だけが箇条書きを `^- ` でしか拾っておらず、**購読者に送った全メールで
 * 素の「*」が本文に出ていた**。バックアップ実測:
 *
 *   - 公開143号のうち **138号が `*` 記法**（`-` だけなのは1号）
 *   - `*` を使った最初の号は **daily 2026-05-16 ＝ 1号目**。つまり**今まで送った全部**
 *   - daily 122号の合計で **3,216行**
 *   - 2026-09-14 号を本番と同じ関数に通すと `<li>` 0個 / `<ul>` 0個 / 素の `*` 18個
 *
 * サイト（`components/Markdown.tsx`）とRSS（`app/feed.xml/route.ts`）はどちらも
 * `/^[-*] /` で両方拾えていた。**メールだけが取り残されていた**＝同じ処理のコピーが3本あり、
 * そのうち1本だけ古い、という第四条(DRY)の典型。読める場所に出してテストを張る。
 *
 * ⚠ 生成しているのは**メール本文に埋め込む断片**であり、完全なHTML文書ではない。
 *   メールクライアントは `<style>` や外部CSSを落とすので、装飾はインラインstyleで書く。
 */

/**
 * 箇条書きの行頭。LLMは `*   ` を好んで出すので `-` だけを見てはいけない（上の経緯）。
 * 行頭の空白も許す: 5月の号は字下げした入れ子（`    * **実践的ヒント:** …`）を出しており、
 * 空白を許さない版で143号を通し直したら **1,133箇所**が素の `*` のまま残った（実測）。
 * 上限を6文字にしてあるのは、深く字下げした塊まで吸い込まないため。
 */
const BULLET_RE = /^[ \t]{0,6}[-*+][ \t]+(.+)$/gm;

/** 水平線。`---` `***` `___` を3つ以上。箇条書きと衝突しないよう記号の後に何も許さない。 */
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/gm;

export function mailMarkdownToHtml(md: string): string {
  let html = md
    .replace(HR_RE, '<hr style="border:0;border-top:1px solid #e2e8f0;margin:14px 0">')
    .replace(/^## (.+)$/gm, '<h2 style="color:#0ea5e9;font-size:16px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin:16px 0 8px">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="color:#4f46e5;font-size:14px;margin:16px 0 4px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:2px 5px;border-radius:4px;font-family:monospace;font-size:0.9em">$1</code>')
    .replace(BULLET_RE, '<li style="margin:3px 0;line-height:1.6">$1</li>')
    .replace(/\n\n+/g, '\n\n');
  html = html.replace(/(<li[^>]*>[\s\S]*?<\/li>\n?)+/g, m => `<ul style="padding-left:20px;margin:4px 0">${m}</ul>`);
  html = html.replace(/\n\n/g, '</p><p style="margin:5px 0;line-height:1.7;color:#334155">');
  html = html.replace(/\n/g, '<br>');
  // ブロック要素（見出し/リスト/水平線）の前後に残る<br>と空段落を除去して間延びを防ぐ
  html = html
    .replace(/(?:<br>\s*)+(<(?:h2|h3|ul|li|hr))/g, '$1')
    .replace(/(<\/(?:h2|h3|ul|li)>|<hr[^>]*>)(?:\s*<br>)+/g, '$1')
    .replace(/<p[^>]*>(?:\s|<br>)*<\/p>/g, '');
  return `<p style="margin:5px 0;line-height:1.7;color:#334155">${html}</p>`;
}
