// robots.txt の規則そのものを扱う純粋関数。ネットワークI/Oは robots.ts が持つ（テスト可能に保つため）。
//
// なぜ書き直したか（2026-09-10 監査）: 旧実装は Disallow の前方一致だけを見ており、
//   ・`Disallow: /*?`（Wired）や `/news/*/*/`（GIGAZINE）など `*` を含む規則が永久にマッチしない
//   ・`Allow:` を一切読まない（禁止の中の例外許可を無視して、取れるものを取らない）
//   ・`Crawl-delay` を無視する（GIGAZINE は 100 を明示しているのに無視して340万字取得していた）
// という状態だった。RFC9309 の照合規則（`*`/`$`・最長一致・同長ならAllow優先）に合わせる。

export type RobotsRule = { allow: boolean; pattern: string };
export type RobotsRules = { rules: RobotsRule[]; crawlDelayMs: number | null };

export const EMPTY_RULES: RobotsRules = { rules: [], crawlDelayMs: null };

/** `*` は任意文字列、末尾 `$` は終端。それ以外は正規表現メタをエスケープする。 */
function toRegExp(pattern: string): RegExp {
  let p = pattern;
  let anchored = false;
  if (p.endsWith('$')) { p = p.slice(0, -1); anchored = true; }
  const body = p
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/**
 * robots.txt を解析し、`uaToken` 宛（無ければ `*` 宛）のグループを返す。
 * RFC9309 どおり、自分の名前に一致するグループがあれば `*` のグループは使わない。
 */
export function parseRobots(txt: string, uaToken: string): RobotsRules {
  const groups: { agents: string[]; rules: RobotsRule[]; delay: number | null }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const val = m[2].trim();

    if (field === 'user-agent') {
      // 連続する User-agent 行は同じグループを共有する（RFC9309）
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;

    if (field === 'disallow') cur.rules.push({ allow: false, pattern: val });
    else if (field === 'allow') cur.rules.push({ allow: true, pattern: val });
    else if (field === 'crawl-delay') {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) cur.delay = n;
    }
  }

  const ua = uaToken.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && a.includes(ua)));
  const picked = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  if (!picked.length) return EMPTY_RULES;

  const rules = picked.flatMap((g) => g.rules).filter((r) => r.pattern !== '');
  const delays = picked.map((g) => g.delay).filter((d): d is number => d != null);
  return {
    rules,
    // 同じ相手に複数指定があれば厳しい方（長い方）を守る
    crawlDelayMs: delays.length ? Math.max(...delays) * 1000 : null,
  };
}

/**
 * パスが許可されているか。RFC9309 の最長一致：一致した規則のうちパターンが最も長いものが勝ち、
 * 同長なら Allow を優先する。どの規則にも当たらなければ許可。
 */
export function isPathAllowed(rules: RobotsRule[], path: string): boolean {
  let bestLen = -1;
  let bestAllow = true;
  for (const r of rules) {
    if (!toRegExp(r.pattern).test(path)) continue;
    // `*`/`$` を除いた実質の長さで特定性を測る（RFC9309 は「オクテット長」だが、
    // ワイルドカードを1文字として数えると `/*` が `/a/b` に勝ってしまうため除外する）
    const len = r.pattern.replace(/[*$]/g, '').length;
    if (len > bestLen || (len === bestLen && r.allow)) { bestLen = len; bestAllow = r.allow; }
  }
  return bestAllow;
}
