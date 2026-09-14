/**
 * RSS（`app/feed.xml/route.ts`）が配る本文HTMLの組み立て。
 *
 * ⚠ ルートのファイルの中に置いていたので **テストから呼べなかった**。
 *   メール（`mail-markdown.ts`・㊳）とまったく同じ理由でここへ出す。
 *   Next のルートファイルはHTTPメソッドとセグメント設定だけを出す場所で、
 *   検証したい純粋関数を同居させると、その経路だけ総当たりの対象から漏れる。
 *
 * 描画そのものは経路ごとに違ってよい（RSSリーダは白背景なので暗色styleを付けない）。
 * 揃えるのは「この行は何か」の判定＝[[markdown-lines]] と、リンクの安全化＝`safeHttpUrl`。
 */

import { SITE_URL } from '@/lib/site';
import { safeHttpUrl } from '@/lib/safeUrl';
import { BULLET_LINE, HR_LINE, bulletContent } from '@/lib/markdown-lines';

// XML/HTMLエスケープ（CDATA外のテキスト＝title等に使う）
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// インラインMarkdown → HTML文字列（Markdown.tsx の parseInline と同じトークン規則）。
// [ID:N] は記事ページへのリンクに、本文テキストは必ずエスケープしてから組み立てる。
export function inlineHtml(text: string): string {
  const regex = /(\[ID:\d+\]|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out += esc(text.slice(last, m.index));
    const t = m[0];
    const idRef = t.match(/^\[ID:(\d+)\]$/);
    const link = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (idRef) {
      out += `<a href="${SITE_URL}/articles/${idRef[1]}">[#${idRef[1]}]</a>`;
    } else if (link) {
      const [, label, url] = link;
      // ⚠ 判定をここに書き写さない（第四条 DRY）。同じ規則が3箇所にコピーされていて、
      //   safeHttpUrl に入れたエンティティ解除（2026-09-15）がここだけ効かなかった。
      const href = safeHttpUrl(url);
      if (href) {
        out += `<a href="${esc(href)}">${esc(label)}</a>`;
      } else {
        out += esc(label);
      }
    // 太字の中身も解釈する（`**`torch.compile` のX**` を素通しにしない）。
    // `[^*]+` の内側に `*` は入らないので再帰は必ず浅く終わる。inlineHtml は内部でエスケープする。
    } else if (t.startsWith('**')) out += `<strong>${inlineHtml(t.slice(2, -2))}</strong>`;
    else if (t.startsWith('*')) out += `<em>${esc(t.slice(1, -1))}</em>`;
    else if (t.startsWith('`')) out += `<code>${esc(t.slice(1, -1))}</code>`;
    else out += esc(t);
    last = m.index + t.length;
  }
  if (last < text.length) out += esc(text.slice(last));
  return out;
}

// レポートMarkdown → RSS向けの軽量セマンティックHTML断片。
// メール用 markdownToHtml(api/report/route.ts) は暗色のフルHTML文書なのでフィードには使わない
// （RSSリーダは白背景でレンダリングするため、インライン暗色スタイルは付けない）。
export function markdownToFeedHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    // ⚠ `####` 以下も受ける。ここが3段だけだったので `#### LLM推論` が記号のまま
    //   <p> に落ちていた（実測10行/2号）。サイト本体・メールと同じ穴が4経路目にも空いていた。
    if (/^#{4,6} /.test(line)) { closeList(); out.push(`<h4>${inlineHtml(line.replace(/^#{4,6} /, ''))}</h4>`); }
    else if (line.startsWith('### ')) { closeList(); out.push(`<h3>${inlineHtml(line.slice(4))}</h3>`); }
    else if (line.startsWith('## ')) { closeList(); out.push(`<h2>${inlineHtml(line.slice(3))}</h2>`); }
    else if (line.startsWith('# ')) { closeList(); out.push(`<h2>${inlineHtml(line.slice(2))}</h2>`); }
    else if (BULLET_LINE.test(line)) {
      // 判定は markdown-lines.ts に集約。`^[-*] ` を書き写していた頃は字下げした入れ子を落としていた。
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inlineHtml(bulletContent(line) ?? '')}</li>`);
    } else if (/^\d+\. /.test(line)) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inlineHtml(line.replace(/^\d+\.\s/, ''))}</li>`);
    } else if (line.startsWith('> ')) { closeList(); out.push(`<blockquote>${inlineHtml(line.slice(2))}</blockquote>`); }
    else if (HR_LINE.test(line)) { closeList(); out.push('<hr>'); }
    else if (!line.trim()) { closeList(); }
    else { closeList(); out.push(`<p>${inlineHtml(line)}</p>`); }
  }
  closeList();
  return out.join('\n');
}

// 本文先頭を素テキスト化した抜粋（<description>用）
export function excerpt(md: string, max = 180): string {
  const text = md
    .replace(/^#{1,6}\s+/gm, '')
    // ⚠ 水平線を先に落とす。`^[-*]\s+` は記号の後に空白を要求するので `---` が生き残り、
    //   RSSリーダの一覧に出る <description> に素の「---」が混ざっていた
    //   （2026-09-15 実測: 実際に配信される50件のうち **23件＝46%**）。
    .replace(new RegExp(HR_LINE.source, 'gm'), '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\[ID:\d+\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}
