import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 「本文が空の号を公開面に出さない」が **3か所すべて** で効いているかを機械で確かめる。
 *
 * ⚠ なぜ要るか（2026-09-15 実測）: この条件は `getRecentDigests` だけが持っていた。
 *   結果、**バックナンバー一覧には出ないのに sitemap・RSS・前号/次号ナビには出る**という
 *   食い違いが起きていた。空の号は実在する（id=81・2026-06-09。当時 LLM が空応答を返し、
 *   それを検証せずに保存した事故の残骸で、生成側は修正済みだが行は消していない）。
 *   実データで確認すると、2026-06-08 の「次号」と 2026-06-10 の「前号」が
 *   どちらもその空の号を指していた＝読者が中身ゼロの紙面に着く導線が2本あった。
 *
 * 条件を1か所（`EMPTY_REPORT_EXCLUDED`）に集めたので、あとは
 * 「使い忘れた関数が無いか」だけを見る。人の目で3か所を揃え続けるのは無理がある。
 */

const SRC = 'src/app/actions.ts';
/**
 * 公開面に**複数の**レポートを出す関数。ここに足したら、この配列にも足すこと。
 *
 * `getLandingDigest` はこのテストを最初に書いたときに**見落としていた**のを、下の
 * 「述語は1か所だけ」のテストが捕まえて足したもの（生の `length(...) > 0` が残っていた）。
 *
 * ⚠ `getReportById`（id 直指定）は**意図的に入れていない**。ここに条件を足すと
 *   `/reports/81` が404になる。空の号でも当時メールで配ったURLではありうるので、
 *   「新たにリンクしない」だけに留め、既に配ったURLは殺さない（失敗の非対称性）。
 */
const PUBLIC_REPORT_QUERIES = ['getReportsData', 'getRecentDigests', 'getAdjacentReports', 'getLandingDigest'];

/** 関数宣言から次の宣言までを本体とみなして切り出す。 */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} が ${SRC} に見つからない`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport (async )?function /);
  return next === -1 ? rest : rest.slice(0, next);
}

test('公開面にレポートを出す関数は全て「本文が空の号」を除いている', () => {
  const src = readFileSync(SRC, 'utf-8');
  for (const name of PUBLIC_REPORT_QUERIES) {
    assert.match(bodyOf(src, name), /EMPTY_REPORT_EXCLUDED/, `${name} が空の号を除いていない`);
  }
});

test('検出器が実際に効く（条件を消した写しでは落ちる）', () => {
  // これが無いと「常に通るだけのテスト」でも緑になる。
  const src = readFileSync(SRC, 'utf-8');
  const mutated = src.replace(
    /\.from\(reports\)\.where\(and\(eq\(reports\.type, type\), sql`\$\{reports\.reportDate\} < \$\{reportDate\}`, EMPTY_REPORT_EXCLUDED\)\)/,
    '.from(reports).where(and(eq(reports.type, type), sql`x`))',
  );
  assert.notEqual(mutated, src, '変異させる対象が見つからなかった（テストが形骸化している）');
  const body = bodyOf(mutated, 'getAdjacentReports');
  // prev 側の条件が消えたので、2回あったはずの出現が1回になる
  assert.equal((body.match(/EMPTY_REPORT_EXCLUDED/g) ?? []).length, 1);
});

test('述語は1か所だけで定義されている（コピーを増やさない）', () => {
  const src = readFileSync(SRC, 'utf-8');
  assert.equal((src.match(/const EMPTY_REPORT_EXCLUDED/g) ?? []).length, 1);
  // 生の length(content) > 0 が別に書かれていないこと
  assert.equal((src.match(/length\(\$\{reports\.content\}\) > 0/g) ?? []).length, 1);
});
