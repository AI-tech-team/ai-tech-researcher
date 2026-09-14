import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONTACT_EMAIL, CONTACT_POINT } from './site';

// 法務ページが「下記の窓口」と書きながら、その下に窓口が無い状態を防ぐ。
// 同じ判断が privacy と terms の4箇所に散っていて、3箇所が切り替えを忘れていた（2026-09-15 実測）。
// 個人情報の開示・訂正・利用停止、GDPRの権利行使、記述の訂正依頼＝いずれも約束している動線なので、
// 読者が辿れない案内のまま置いてはいけない。

test('窓口の呼び名は CONTACT_EMAIL の有無と一致する', () => {
  assert.equal(CONTACT_POINT, CONTACT_EMAIL ? '下記の窓口' : '運営者');
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('「下記の窓口」を直書きしない（窓口の有無で切り替わらなくなるため）', () => {
  const root = join(process.cwd(), 'src');
  const offenders = walk(root)
    .filter(p => !p.endsWith(join('lib', 'site.ts')) && !p.endsWith('.test.ts'))
    .filter(p => readFileSync(p, 'utf-8').includes('下記の窓口'));
  assert.deepEqual(
    offenders.map(p => p.slice(root.length + 1)),
    [],
    'CONTACT_POINT を使うこと（窓口が無いときに存在しない「下記」を案内しないため）',
  );
});
