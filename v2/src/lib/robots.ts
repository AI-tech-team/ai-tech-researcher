// robots.txt の Disallow を簡易評価し、本文取得が許可されているか判定する（第三条: スクレイピングのマナー）。
// 完全なRFC9309実装ではないが「明示的にDisallowされたパスは取りに行かない」を守る保守的ゲート。
// originごとに6時間メモリキャッシュ（毎回robots.txtを叩かない）。取得失敗/不在は「制限なし」とみなす。
import { isSafeFetchUrl } from './safeUrl';

const UA_TOKEN = 'airesearcher'; // 自分のUA名（User-Agent: AIResearcher/1.0）
const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { rules: string[]; at: number }>();

// User-agent が `*` または自分宛のグループの Disallow パスだけを集約する。
function parseDisallow(txt: string): string[] {
  const groups: { agents: string[]; disallow: string[] }[] = [];
  let cur: { agents: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const val = m[2].trim();
    if (field === 'user-agent') {
      if (!lastWasAgent || !cur) { cur = { agents: [], disallow: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'disallow' && cur) {
      cur.disallow.push(val);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const out: string[] = [];
  for (const g of groups) {
    if (g.agents.some(a => a === '*' || a.includes(UA_TOKEN))) out.push(...g.disallow);
  }
  return out;
}

export async function isAllowedByRobots(targetUrl: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(targetUrl); } catch { return false; }
  const origin = `${u.protocol}//${u.host}`;
  const now = Date.now();
  let entry = cache.get(origin);
  if (!entry || now - entry.at > TTL_MS) {
    let rules: string[] = [];
    const robotsUrl = `${origin}/robots.txt`;
    if (isSafeFetchUrl(robotsUrl)) {
      try {
        const res = await fetch(robotsUrl, {
          headers: { 'User-Agent': 'AIResearcher/1.0 (+https://ai-tech-researcher.vercel.app)' },
          signal: AbortSignal.timeout(5000),
          redirect: 'follow',
        });
        // 200かつテキストのみ採用。404等(robots不在)は「制限なし」とみなす（rules空）。
        if (res.ok && /text\//i.test(res.headers.get('content-type') ?? 'text/plain')) {
          rules = parseDisallow((await res.text()).slice(0, 100_000));
        }
      } catch { rules = []; }
    }
    entry = { rules, at: now };
    cache.set(origin, entry);
  }
  const path = u.pathname || '/';
  for (const d of entry.rules) {
    if (d === '') continue;        // 空Disallow = 全許可（グループ内に制限なし）
    if (d === '/') return false;   // 全面禁止
    if (path.startsWith(d)) return false;
  }
  return true;
}
