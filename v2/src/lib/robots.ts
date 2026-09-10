// robots.txt を評価し、取得してよいURLかを判定する（第三条: スクレイピングのマナー）。
// 照合規則そのものは robots-rules.ts（純粋関数・テスト済み）に置き、ここはI/Oとキャッシュだけを持つ。
// originごとに6時間メモリキャッシュ（毎回robots.txtを叩かない）。取得失敗/不在は「制限なし」とみなす。
import { isSafeFetchUrl } from './safeUrl';
import { CRAWL_CONTACT_URL } from './site';
import { parseRobots, isPathAllowed, EMPTY_RULES, type RobotsRules } from './robots-rules';

const UA_TOKEN = 'cernoval'; // 自分のUA名（User-Agent: Cernoval/1.0）と一致させる
const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { r: RobotsRules; at: number }>();
/** origin ごとの「次に叩いてよい時刻」。Crawl-delay を守るために使う。 */
const nextOkAt = new Map<string, number>();

async function rulesFor(origin: string): Promise<RobotsRules> {
  const now = Date.now();
  const hit = cache.get(origin);
  if (hit && now - hit.at <= TTL_MS) return hit.r;

  let r: RobotsRules = EMPTY_RULES;
  const robotsUrl = `${origin}/robots.txt`;
  if (isSafeFetchUrl(robotsUrl)) {
    try {
      const res = await fetch(robotsUrl, {
        headers: { 'User-Agent': `Cernoval/1.0 (+${CRAWL_CONTACT_URL})` },
        signal: AbortSignal.timeout(5000),
        redirect: 'follow',
      });
      // 200かつテキストのみ採用。404等(robots不在)は「制限なし」とみなす。
      if (res.ok && /text\//i.test(res.headers.get('content-type') ?? 'text/plain')) {
        r = parseRobots((await res.text()).slice(0, 100_000), UA_TOKEN);
      }
    } catch { r = EMPTY_RULES; }
  }
  cache.set(origin, { r, at: now });
  return r;
}

export async function isAllowedByRobots(targetUrl: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(targetUrl); } catch { return false; }
  const r = await rulesFor(`${u.protocol}//${u.host}`);
  // `Disallow: /*?` のようにクエリを対象にする規則があるので、search を含めて照合する。
  return isPathAllowed(r.rules, (u.pathname || '/') + (u.search || ''));
}

/**
 * 相手が Crawl-delay を指定していれば、その間隔が空くまで待つ。
 * 待つ相手は origin 単位。指定が無ければ即座に返る（＝呼んでも無害）。
 * 上限を設けるのは、極端な値（例: 86400）で日次パイプラインが止まらないようにするため。
 */
const MAX_WAIT_MS = 30_000;

/**
 * robots.txt を守って取得する。フィード取得・フィード自動発見はここを通す。
 * 拒否されたら `null` を返す（例外にしない＝呼び出し側の失敗カウンタを汚さないため）。
 *
 * 旧実装ではこのゲートが本文取得経路にしか無く、フィード取得は素通りだった。
 * その結果 `Disallow: /` を明示している Reddit を毎日巡回して2,306件収集していた（2026-09-10 監査）。
 */
export async function politeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  if (!isSafeFetchUrl(url)) return null;
  if (!(await isAllowedByRobots(url))) return null;
  await awaitCrawlDelay(url);
  const headers = { 'User-Agent': `Cernoval/1.0 (+${CRAWL_CONTACT_URL})`, ...(init?.headers ?? {}) };
  return fetch(url, { ...init, headers });
}

export async function awaitCrawlDelay(targetUrl: string): Promise<void> {
  let u: URL;
  try { u = new URL(targetUrl); } catch { return; }
  const origin = `${u.protocol}//${u.host}`;
  const r = await rulesFor(origin);
  if (!r.crawlDelayMs) return;
  const wait = Math.min(r.crawlDelayMs, MAX_WAIT_MS);
  const now = Date.now();
  const ok = nextOkAt.get(origin) ?? 0;
  if (ok > now) await new Promise((res) => setTimeout(res, Math.min(ok - now, MAX_WAIT_MS)));
  nextOkAt.set(origin, Date.now() + wait);
}
