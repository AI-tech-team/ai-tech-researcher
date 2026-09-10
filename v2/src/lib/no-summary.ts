// 要約が無い記事に、その理由を出す。
//
// なぜ必要か（2026-09-10）:
//   監査の是正で「本文を読んでいない記事に要約を付けない」ことにした結果、本番に要約の無い記事が
//   1,710件（全体の7.5%）できた。ところが公開UIのカードは `{item.summary && ...}` で、
//   summary が null のときは**何も描画しない＝空欄**になる。これは設計時に明示的に却下した案で、
//   読者には「壊れている」としか見えず、こちらが何を守ったのかが1ミリも伝わらない。
//
// なぜ理由を分けるか:
//   一言でまとめると「唯一まずいケース（本文を取得できなかった）」が他に紛れて見えなくなる。
//   逆に robots 拒否や形式非対応は、書いてあること自体が相手の意思を尊重している証拠なので隠す理由がない。
//
// 分類は実データの分布に合わせてある（2026-09-10 本番実測・要約なし1,710件の内訳）:
//   本文あり・エラー記録なし        1,101件  ← 最多。読んではいる＝「読んでいません」は嘘になる
//   本文なし・エラー記録なし          264件
//   unsupported_domain             230件（YouTube 290 / speakerdeck 30 等）
//   http_403                        38件
//   too_short                       38件
//   robots_disallow                 25件  ← 設計時は主要3分類の1つに置いていたが実際はごく少数
//   not_html:*                       8件
//   ※ robots 拒否の記事は全体で2,023件あるが、その1,998件はRSS配信の抜粋から要約が作れている。

/** 要約が無い理由の種別。UI側で色や強調を変えるために種別を持たせる。
 *  'unknown' は「理由を判定する材料が手元に無い」。**知らないことを断定しない**ために分けてある
 *  （列を積んでいない検索経路などから呼ばれたとき、本文があるのに「読んでいません」と書くと嘘になる）。 */
export type NoSummaryKind = 'pending' | 'robots' | 'unsupported' | 'not_read' | 'unknown';

export type NoSummaryReason = { kind: NoSummaryKind; text: string };

export type NoSummaryInput = {
  summary?: string | null;
  /** 抽出本文を持っているか。本文そのものはクライアントに渡さない（第三条）。 */
  hasBody?: boolean | null;
  extractError?: string | null;
};

/**
 * 要約が無い記事に出す一文を返す。要約があるときは null（何も出さない）。
 *
 * 文言はすべて「できなかった」ではなく「しない」で書く。実際にこれは失敗ではなく設計判断で、
 * 不具合として見せると自分の約束を不具合に見せかけることになる。
 */
export function noSummaryReason(item: NoSummaryInput): NoSummaryReason | null {
  const s = item.summary;
  if (typeof s === 'string' && s.trim() !== '') return null;

  const err = (item.extractError ?? '').trim();

  // 相手が巡回を許可していない。こちらの限界ではなく相手の意思の尊重なので最初に判定する。
  if (err === 'robots_disallow') {
    return {
      kind: 'robots',
      text: '元サイトの方針により、本紙は本文を取得していません。見出しと元記事へのリンクのみをお伝えします。',
    };
  }

  // 本文を持っているなら、何があっても「読んでいません」とは書かない（嘘になる）。
  // 過去の抽出失敗タグが残ったまま、別経路で本文が取れている記事があるため、エラータグより優先する。
  // （元の要約が他サイトの文章の複製だったため取り下げた記事がここに入る＝実測で最多の1,101件）
  if (item.hasBody === true) {
    return {
      kind: 'pending',
      text: '本紙が書いた要約がまだありません。他サイトの要約をそのまま載せることはしません。',
    };
  }

  // テキストで本文が配信されていない形式（動画・スライド・PDF等）。
  if (err === 'unsupported_domain' || err.startsWith('not_html:')) {
    return {
      kind: 'unsupported',
      text: '元サイトが本文をテキストで配信していないため、本紙は内容を読んでいません。',
    };
  }

  // 取得を試みて失敗した（http_403 / http_404 / http_429 / timeout / fetch_error / too_short ほか）。
  // 未知のタグもここに入れる。タグが付いていること自体が「試行して失敗した」証拠なので。
  if (err !== '') {
    return {
      kind: 'not_read',
      text: '本紙はこの記事を読んでいません。元サイトから本文を取得できなかったため、見出しだけで要約を書くことはしません。',
    };
  }

  // 本文が無いと分かっている。
  if (item.hasBody === false) {
    return {
      kind: 'not_read',
      text: '本紙はこの記事を読んでいません。元サイトが本文を配信していないため、見出しだけで要約を書くことはしません。',
    };
  }

  // ここに来るのは hasBody が undefined＝**判定材料が無い**とき。
  // 「読んでいません」と書くと、本文を持っている記事に対して嘘になる。分からないことは言わない。
  return {
    kind: 'unknown',
    text: '本紙が書いた要約はまだありません。他サイトの要約をそのまま載せることはしません。',
  };
}

/** 一覧・検索結果で1行に圧縮したいときの短い版。 */
export function noSummaryShort(item: NoSummaryInput): string | null {
  const r = noSummaryReason(item);
  if (!r) return null;
  switch (r.kind) {
    case 'pending': return '本紙の要約はまだありません';
    case 'robots': return '本紙未読 — 元サイトの方針により本文を取得していません';
    case 'unsupported': return '本紙未読 — 本文がテキストで配信されていません';
    case 'not_read': return '本紙未読 — 元サイトが本文を配信していません';
    case 'unknown': return '本紙の要約はまだありません';
  }
}
