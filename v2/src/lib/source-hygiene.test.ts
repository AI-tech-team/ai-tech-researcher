import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ソースに**生の制御文字**が紛れていないことを機械的に守る。
 *
 * ⚠ なぜ要るか（2026-09-15 に実際に起きた）:
 * 編集をヒアドキュメント経由で流し込んだとき `\uXXXX` のバックスラッシュが潰れ、
 * 正規表現の中に **本物の NUL バイト**が書き込まれた。
 *   src/lib/safeUrl.ts        /[\u0000-\u0020\u007f]/  →  /[<NUL>- <DEL>]/
 *   src/lib/entity-quality.ts /[\u0000-\u001f]/        →  /[<NUL>-<0x1f>]/
 *
 * **動作は同一**（文字クラスの範囲としては等価）なので、型検査もテストも本番も全部通る。
 * 見つかったのは grep が「Binary file … matches」と言って**定義行を表示しなかった**から。
 * つまり静かに壊れるのは挙動ではなく**読める・探せるという性質**で、
 * 検索から漏れるファイルは次に誰かが直すときに見落とされる。
 *
 * バイト列を直接見る検査なので、同じ事故はここで必ず止まる。
 */
const ROOTS = ['src'];
const EXTRA = ['daily_pipeline.ts', 'next.config.ts', 'middleware.ts'];
const SKIP_DIR = /^(node_modules|\.next|\.git)$/;

function collect(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (/\.(ts|tsx|js|mjs|css|json|md)$/.test(e.name)) out.push(p);
  }
}

test('ソースに生の制御文字（タブ・改行以外）が入っていない', () => {
  const files: string[] = [];
  for (const r of ROOTS) if (fs.existsSync(r)) collect(r, files);
  for (const f of EXTRA) if (fs.existsSync(f)) files.push(f);
  assert.ok(files.length > 50, `走査対象が少なすぎる: ${files.length}件`);

  const bad: string[] = [];
  const TAB = 9, LF = 10, CR = 13, SPACE = 32, DEL = 127;
  for (const f of files) {
    const buf = fs.readFileSync(f);
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c === TAB || c === LF || c === CR) continue;
      if (c < SPACE || c === DEL) {
        const line = buf.subarray(0, i).toString('utf8').split('\n').length;
        bad.push(`${f}:${line} に 0x${c.toString(16).padStart(2, "0")} が生のまま入っている（u00xx 形式のエスケープで書くこと）`);
        break; // 1ファイル1件報告すれば十分
      }
    }
  }
  assert.deepEqual(bad, [], `生の制御文字が入っている:\n${bad.join('\n')}`);
});
