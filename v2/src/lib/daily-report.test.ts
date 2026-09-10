import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTopWithDomainCap } from './daily-report';

const u = (host: string, n: number) => ({ url: `https://${host}/a${n}` });

test('1ドメインは上限まで', () => {
  const rows = [...Array(10)].map((_, i) => u('apple.example', i));
  const got = pickTopWithDomainCap(rows, 40, 5);
  assert.equal(got.length, 10, '枠が余るので上限超過分も補充される');
  assert.deepEqual(got.slice(0, 5), rows.slice(0, 5), '先に上限分が入る');
});

test('上限を超えた分は後回しになり、他ドメインが先に入る', () => {
  const rows = [...[...Array(8)].map((_, i) => u('apple.example', i)), u('other.example', 0)];
  const got = pickTopWithDomainCap(rows, 6, 5);
  assert.equal(got.length, 6);
  assert.equal(got[5].url, 'https://other.example/a0', '6番目は Apple ではなく別ドメイン');
});

test('www は同一ドメインとして数える', () => {
  const rows = [
    { url: 'https://www.apple.example/1' }, { url: 'https://apple.example/2' },
    { url: 'https://www.apple.example/3' }, { url: 'https://other.example/1' },
  ];
  const got = pickTopWithDomainCap(rows, 4, 2);
  assert.deepEqual(got.map(r => r.url), [
    'https://www.apple.example/1', 'https://apple.example/2',
    'https://other.example/1', 'https://www.apple.example/3',
  ]);
});

test('limit で打ち切る', () => {
  const rows = [...Array(50)].map((_, i) => u(`d${i}.example`, i));
  assert.equal(pickTopWithDomainCap(rows, 40, 5).length, 40);
});

test('URLが無い・壊れている行も落とさない', () => {
  const rows = [{ url: null }, { url: 'not a url' }, u('a.example', 1)];
  assert.equal(pickTopWithDomainCap(rows, 40, 5).length, 3, '欠落より冗長を選ぶ');
});

test('入力が空なら空', () => {
  assert.deepEqual(pickTopWithDomainCap([], 40, 5), []);
});
