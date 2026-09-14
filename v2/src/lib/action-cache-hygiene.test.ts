import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 「共有キャッシュの配列に、ユーザー別状態を直接書き込んでいないか」を機械的に守る。
 *
 * cached() はインスタンス内で**同じ配列の参照**を返す。そこへ overlayUserState() を
 * そのまま掛けると、先に開いた人のお気に入り/既読がキャッシュに焼き付き、次に開いた別人へ配られる。
 * 現状 getCollectedDataList は `base.map(i => ({ ...i }))` でコピーしてから掛けており正しいが、
 * これは**コメントでしか守られていない**不変条件で、あとから性能のためにキャッシュを足した人が
 * 静かに壊せる。人の注意ではなく検査で守る（[[pattern-wired-but-never-called]] と同じ理由で、
 * 「書いてあるから大丈夫」は確認を省く理由にならない）。
 */

/** actions.ts をトップレベル関数ごとに切り出す（波括弧の深さで区切る） */
function topLevelFunctions(src: string): { name: string; body: string }[] {
  const lines = src.split('\n');
  const out: { name: string; body: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:export )?async function ([A-Za-z0-9_]+)/);
    if (!m) continue;
    let depth = 0, started = false, j = i;
    for (; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') depth--;
      }
      if (started && depth === 0) break;
    }
    out.push({ name: m[1], body: lines.slice(i, j + 1).join('\n') });
    i = j;
  }
  return out;
}

test('共有キャッシュの結果にユーザー状態を直接書き込まない', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/actions.ts'), 'utf-8');
  const fns = topLevelFunctions(src);
  assert.ok(fns.length > 20, `関数の切り出しに失敗している可能性: ${fns.length}件`);

  const risky = fns.filter(f => f.body.includes('cached(') && f.body.includes('overlayUserState('));
  // 見張る対象が消えたら、このテストは何も守っていない（検査が空振りしていることに気づけるように）
  assert.ok(risky.length > 0, 'cached() と overlayUserState() が同居する関数が1つも無い＝検査が空振り');

  for (const f of risky) {
    const copied = /\.map\(\s*\w+\s*=>\s*\(?\s*\{\s*\.\.\./.test(f.body);
    assert.ok(copied, `${f.name}: cached() の結果に overlayUserState() を掛ける前の浅いコピーが見当たらない`);
  }
});

test('ユーザー別の件数をキャッシュしていない', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/actions.ts'), 'utf-8');
  const fn = topLevelFunctions(src).find(f => f.name === 'getArticleCounts');
  assert.ok(fn, 'getArticleCounts が見つからない');
  // user_article_state を引く行が cached() のコールバックの中にあってはいけない。
  // 素朴に: cached( の開始位置より後ろで userArticleState を引くなら、同じ行に無いことを確かめる。
  const inCache = fn!.body.split('\n').filter(l => l.includes('userArticleState') && l.includes('cached('));
  assert.deepEqual(inCache, [], 'ユーザー別の件数がキャッシュに入っている');
  assert.ok(fn!.body.includes("cached('articleTotal'"), '全体件数はキャッシュしてよい（読み取り削減）');
});
