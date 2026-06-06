import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from './llm';

// LLMの自由文出力から最初のJSON(オブジェクト/配列)を頑健に取り出す。
test('extractJson: コードフェンス付きJSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1,"b":"x"}\n```'), { a: 1, b: 'x' });
});

test('extractJson: 前後に地の文があっても抽出', () => {
  assert.deepEqual(extractJson('結果は次の通りです {"a":1} 以上'), { a: 1 });
});

test('extractJson: 配列も取り出す', () => {
  assert.deepEqual(extractJson('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(extractJson('前置き [{"x":1}] 後置き'), [{ x: 1 }]);
});

test('extractJson: JSONが無ければ例外', () => {
  assert.throws(() => extractJson('ここにJSONはありません'));
});
