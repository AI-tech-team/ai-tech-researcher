import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noSummaryReason, noSummaryShort } from './no-summary';

test('要約があれば何も出さない', () => {
  assert.equal(noSummaryReason({ summary: '本文の要約です' }), null);
  assert.equal(noSummaryShort({ summary: '本文の要約です' }), null);
});

test('空文字・空白だけの要約は「無い」とみなす', () => {
  assert.notEqual(noSummaryReason({ summary: '' }), null);
  assert.notEqual(noSummaryReason({ summary: '   ' }), null);
  assert.notEqual(noSummaryReason({ summary: null }), null);
  assert.notEqual(noSummaryReason({}), null);
});

test('robots拒否は相手の意思として書く（こちらの失敗として書かない）', () => {
  const r = noSummaryReason({ summary: null, extractError: 'robots_disallow' })!;
  assert.equal(r.kind, 'robots');
  assert.match(r.text, /元サイトの方針/);
  // 「できなかった」と読める語を使わない
  assert.doesNotMatch(r.text, /できません|失敗|申し訳/);
});

test('本文がテキスト配信されていない形式を分ける', () => {
  for (const e of ['unsupported_domain', 'not_html:application/pdf', 'not_html:text/plain']) {
    const r = noSummaryReason({ summary: null, extractError: e })!;
    assert.equal(r.kind, 'unsupported', e);
  }
});

test('取得に失敗した場合は「読んでいない」と明示する', () => {
  for (const e of ['http_403', 'http_404', 'http_429', 'timeout', 'fetch_error', 'too_short']) {
    const r = noSummaryReason({ summary: null, extractError: e })!;
    assert.equal(r.kind, 'not_read', e);
    assert.match(r.text, /読んでいません/);
  }
});

test('本文を持っている記事に「読んでいません」と書かない（嘘になる）', () => {
  const r = noSummaryReason({ summary: null, hasBody: true })!;
  assert.equal(r.kind, 'pending');
  assert.doesNotMatch(r.text, /読んでいません/);
  assert.match(r.text, /他サイトの要約/);
});

test('本文が無いと分かっているときは「読んでいない」と書く', () => {
  const r = noSummaryReason({ summary: null, hasBody: false })!;
  assert.equal(r.kind, 'not_read');
  assert.match(r.text, /読んでいません/);
});

test('判定材料が無いときは「読んでいない」と断定しない（嘘を防ぐ）', () => {
  // hasBody も extractError も渡されない経路（列を積んでいない検索など）
  const r = noSummaryReason({ summary: null })!;
  assert.equal(r.kind, 'unknown');
  assert.doesNotMatch(r.text, /読んでいません/);
  assert.doesNotMatch(noSummaryShort({ summary: null })!, /未読/);
});

test('robots拒否だけは本文の有無より優先される（相手の方針の表明なので）', () => {
  const r = noSummaryReason({ summary: null, hasBody: true, extractError: 'robots_disallow' })!;
  assert.equal(r.kind, 'robots');
});

test('本文があれば、古い失敗タグが残っていても「読んでいません」と書かない', () => {
  // 抽出に一度失敗し、後から別経路で本文が取れた記事。タグだけ残っているケース。
  for (const e of ['http_404', 'unsupported_domain', 'too_short', 'brand_new_tag']) {
    const r = noSummaryReason({ summary: null, hasBody: true, extractError: e })!;
    assert.equal(r.kind, 'pending', e);
    assert.doesNotMatch(r.text, /読んでいません/, e);
  }
});

test('未知のエラータグは「読んでいない」側に倒す（タグの存在＝試行して失敗した証拠）', () => {
  const r = noSummaryReason({ summary: null, extractError: 'brand_new_tag' })!;
  assert.equal(r.kind, 'not_read');
});

test('短い版はすべての種別で文字列を返す', () => {
  const inputs: Parameters<typeof noSummaryShort>[0][] = [
    { summary: null, hasBody: true },
    { summary: null, extractError: 'robots_disallow' },
    { summary: null, extractError: 'unsupported_domain' },
    { summary: null, extractError: 'http_404' },
  ];
  for (const i of inputs) {
    const s = noSummaryShort(i);
    assert.equal(typeof s, 'string');
    assert.ok(s!.length > 0);
  }
});

test('文言に謝罪や不具合を示す語を使わない（設計判断であって失敗ではない）', () => {
  const inputs: Parameters<typeof noSummaryReason>[0][] = [
    { summary: null, hasBody: true },
    { summary: null, extractError: 'robots_disallow' },
    { summary: null, extractError: 'unsupported_domain' },
    { summary: null, extractError: 'http_404' },
    { summary: null, hasBody: false },
  ];
  for (const i of inputs) {
    const t = noSummaryReason(i)!.text;
    assert.doesNotMatch(t, /申し訳|すみません|エラー|失敗しました|生成できませんでした/);
  }
});
