// 固定ウィンドウ・カウンタ方式のレート制限。
// userId（または'owner'）で識別＝IP/UA等のPIIを使わない（匿名性と両立）。
// rate_limits 表（migrate_rate_limits.ts）を共有ストアにし、Vercelのインスタンス跨ぎでも効く。
// 失敗時は fail-open（DB不調で正規利用を巻き込まないため）。
import { client } from '@/db';

export async function checkRateLimit(
  name: string,
  key: string | number,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const bucket = `${name}:${key}:${windowStart}`;
    const res = await client.execute({
      sql: `INSERT INTO rate_limits (bucket, count, expires_at) VALUES (?, 1, ?)
            ON CONFLICT(bucket) DO UPDATE SET count = count + 1
            RETURNING count`,
      args: [bucket, windowStart + windowMs],
    });
    const count = Number((res.rows[0] as { count?: number } | undefined)?.count ?? 1);
    // 期限切れ行を確率的に掃除（コスト分散）
    if (Math.random() < 0.02) {
      await client.execute({ sql: `DELETE FROM rate_limits WHERE expires_at < ?`, args: [now] });
    }
    return count <= limit;
  } catch {
    return true; // fail-open
  }
}
