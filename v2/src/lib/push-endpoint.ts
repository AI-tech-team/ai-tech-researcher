// Web Push の endpoint が「実在するプッシュサービスのものか」を決める許可リスト。
//
// なぜ必要か: savePushSubscription はログイン不要で呼べる。endpoint を検証しないと、
// 攻撃者が任意のURLを大量に登録でき、毎朝のジョブがそれを1件ずつ順にPOSTしにいく
// （＝配信が詰まって日次レポートが止まる／Runner からのブラインドSSRF）。
// endpoint は「送信先」であって「取得元」ではないので isSafeFetchUrl だけでは足りず、
// ホストそのものを既知のプッシュサービスに限定する。

/** 完全一致で許可するホスト */
const EXACT = new Set([
  'fcm.googleapis.com',            // Chrome / Edge (FCM)
  'android.googleapis.com',        // Chrome 旧 GCM
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com',            // Safari / iOS
]);

/** このサフィックスを持つサブドメインを許可（`.` 込みで比較し hoge-notify.windows.com を弾く） */
const SUFFIX = [
  '.push.services.mozilla.com',    // Firefox のリージョン別ホスト
  '.notify.windows.com',           // Edge 旧 WNS (wns2-*.notify.windows.com)
  '.push.apple.com',               // Apple のリージョン別ホスト
];

/**
 * 許可されたプッシュサービスの endpoint かどうか。
 * https 以外、ポート指定、資格情報付きURLは全て拒否する。
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.port) return false;                      // 既知サービスは全て443
  if (u.username || u.password) return false;    // https://evil@fcm.googleapis.com/ 対策
  const host = u.hostname.toLowerCase();
  if (EXACT.has(host)) return true;
  return SUFFIX.some((s) => host.endsWith(s));
}
