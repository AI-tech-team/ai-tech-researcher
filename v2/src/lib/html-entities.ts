// RSS/HTML 由来のタイトル・要約に残る HTML エンティティを実体に戻す。
//
// なぜ要るか（2026-09-10 監査）: 本番タイトル 1,483件 (6.4%) に `&#039;` `&amp;` `&#8217;` が
// そのまま残っており、有料メールの本文にも出ていた。加えて `GPT&#45;5.6 Sol` のように
// エンティティが固有名を割り、接続語の抽出まで壊していた（`GPT` と `Sol` に分かれる）。

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', middot: '·', bull: '•', trade: '™',
  copy: '©', reg: '®', deg: '°', laquo: '«', raquo: '»', times: '×',
  eacute: 'é', egrave: 'è', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç',
};

// 制御文字・サロゲート領域は捨てる（不正な数値参照でタイトルを壊さない）
function fromCodePoint(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return '';
  if (n >= 0xd800 && n <= 0xdfff) return '';
  if (n < 0x20 && n !== 0x09 && n !== 0x0a) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

/**
 * 名前付き・10進・16進のエンティティをデコードする。
 * `&amp;#039;` のような二重エスケープに対応するため、変化しなくなるまで最大3回繰り返す。
 */
export function decodeHtmlEntities(input: string): string {
  if (!input || !input.includes('&')) return input;
  let s = input;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]{1,31});/g, (m, body: string) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X';
        const n = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        return fromCodePoint(n) || m;
      }
      const v = NAMED[body.toLowerCase()];
      return v ?? m; // 知らない名前は触らない（原文を壊さない）
    });
    if (next === s) break;
    s = next;
  }
  return s;
}
