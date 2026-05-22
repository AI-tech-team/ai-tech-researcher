// 重い集計クエリの短期メモリキャッシュ（同一インスタンス内で有効）。
// 解析系は頻繁に変わらないため数分のTTLで体感速度とDB負荷を改善する。
const store = new Map<string, { value: unknown; expires: number }>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}
