// 固定ウィンドウ・カウンタ方式のレート制限。
// userId（または'owner'）で識別＝IP/UA等のPIIを使わない（匿名性と両立）。
// rate_limits 表（migrate_rate_limits.ts）を共有ストアにし、Vercelのインスタンス跨ぎでも効く。
// DB障害時は「全開（fail-open）」にせず、インスタンス内メモリの簡易カウンタで制限を維持する
// （正規利用は通しつつ、DB不調時の無制限濫用を防ぐ多層防御）。
import { client } from '@/db';

// DB障害時のフォールバック用カウンタ（プロセス内）。Vercelのインスタンス単位で効く。
const memBuckets = new Map<string, { count: number; resetAt: number }>();

function memCheck(bucket: string, windowEnd: number, limit: number, now: number): boolean {
  const e = memBuckets.get(bucket);
  if (!e || e.resetAt <= now) {
    memBuckets.set(bucket, { count: 1, resetAt: windowEnd });
    // 軽い掃除（肥大化防止）
    if (memBuckets.size > 5000) {
      for (const [k, v] of memBuckets) if (v.resetAt <= now) memBuckets.delete(k);
    }
    return 1 <= limit;
  }
  e.count += 1;
  return e.count <= limit;
}

export async function checkRateLimit(
  name: string,
  key: string | number,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  const bucket = `${name}:${key}:${windowStart}`;
  try {
    const res = await client.execute({
      sql: `INSERT INTO rate_limits (bucket, count, expires_at) VALUES (?, 1, ?)
            ON CONFLICT(bucket) DO UPDATE SET count = count + 1
            RETURNING count`,
      args: [bucket, windowEnd],
    });
    const count = Number((res.rows[0] as { count?: number } | undefined)?.count ?? 1);
    // 期限切れ行を確率的に掃除（コスト分散）
    if (Math.random() < 0.02) {
      await client.execute({ sql: `DELETE FROM rate_limits WHERE expires_at < ?`, args: [now] });
    }
    return count <= limit;
  } catch {
    // DB障害時: 全開にせず、インスタンス内メモリで簡易的に同じ窓・上限を適用する
    return memCheck(bucket, windowEnd, limit, now);
  }
}
