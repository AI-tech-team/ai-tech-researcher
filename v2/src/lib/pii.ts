// 個人情報(PII)の軽量マスキング。ログ/エラー通知などに紛れ込んだ「明白なPII」を伏せる多層防御。
// 方針: 一般語や本文の意味を壊さないよう、誤検出しにくい明確なパターンのみを対象にする
//       （メール / カード番号 / 電話番号 / 長い数字列）。氏名や一般文字列はマスクしない。
// ⚠️ 検索クエリ・興味/目標の埋め込みなど「機能パス」には使わない（過剰マスクで精度を落とすため）。
//    用途は「外部へ出る/残るテキストの保険」（エラー通知メール等）に限定する。

const PATTERNS: [RegExp, string][] = [
  // メールアドレス
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
  // クレジットカード様（4-4-4-4 区切り）
  [/\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g, '[card]'],
  // 日本の電話番号（ハイフン区切り・0始まり）
  [/\b0\d{1,4}-\d{1,4}-\d{3,4}\b/g, '[phone]'],
  // 連続する長い数字列（電話/口座/会員番号/カード等。11桁以上＝年号や短いIDは避ける）
  [/\b\d{11,}\b/g, '[number]'],
];

// 文字列内の明白なPIIを伏せ字に置換する。null/undefined安全。
export function maskPII(input: string | null | undefined): string {
  if (!input) return input ?? '';
  let out = input;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
