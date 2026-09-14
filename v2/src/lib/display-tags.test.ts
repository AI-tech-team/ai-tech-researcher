import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDisplayableTag, displayTags } from './display-tags';

// ケースは backup_2026-09-13 の実測（タグ8,373件のうち話題は2,765件＝33.0%）から取っている。
test('isDisplayableTag: 内部メタデータは出さない', () => {
  for (const t of ['hn-score:770', 'hn-score:514', 'score:1.5']) {
    assert.equal(isDisplayableTag(t), false, `${t} は内部メタデータ`);
  }
});

test('isDisplayableTag: ホスト名は出さない（sourceValue で別に見せている）', () => {
  for (const t of ['techcrunch.com', 'zenn.dev', 'lobste.rs', 'brew.sh', 'news.ycombinator.com']) {
    assert.equal(isDisplayableTag(t), false, `${t} はホスト名`);
  }
});

test('isDisplayableTag: 収集元の名前は出さない', () => {
  for (const t of ['hn', 'hacker-news', 'arxiv', 'zenn', 'qiita', 'YouTube']) {
    assert.equal(isDisplayableTag(t), false, `${t} はソース名`);
  }
});

// ⚠ 誤爆の歯止め。話題タグを消したら本末転倒。
test('isDisplayableTag: 話題タグは残す', () => {
  for (const t of ['LLM推論', 'エージェント', 'KVキャッシュ', 'Gemini Omni', 'AI Governance', 'オンデバイス', 'next.js', 'llama.cpp']) {
    assert.equal(isDisplayableTag(t), true, `${t} を消してはいけない`);
  }
});

// ⚠ 収集側は [ソース名, ドメイン] を**先頭**に入れる。先に上限を当てると枠がそれで埋まり、
//   本来の話題タグが押し出される（実測で記事ページの6枠がメタデータで埋まっていた）。
test('displayTags: 絞ってから上限を当てる（メタデータに枠を食わせない）', () => {
  const tags = ['hn', 'news.ycombinator.com', 'hn-score:770', 'LLM推論', 'エージェント', 'KVキャッシュ'];
  assert.deepEqual(displayTags(tags, 3), ['LLM推論', 'エージェント', 'KVキャッシュ']);
});

test('displayTags: 空・null でも落ちない', () => {
  assert.deepEqual(displayTags(null, 3), []);
  assert.deepEqual(displayTags(['hn', 'arxiv'], 3), []);
});
