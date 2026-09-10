import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedPushEndpoint } from './push-endpoint';

test('実在するプッシュサービスは通す', () => {
  for (const e of [
    'https://fcm.googleapis.com/fcm/send/dGhpcy1pcy1hLXRlc3Q',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAA',
    'https://autopush.stage.push.services.mozilla.com/wpush/v2/x',
    'https://web.push.apple.com/QC1ZAAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ]) assert.equal(isAllowedPushEndpoint(e), true, e);
});

test('任意のURLは弾く（SSRF・配信詰まりの防止）', () => {
  for (const e of [
    'http://169.254.169.254/latest/meta-data/',      // クラウドのメタデータ
    'https://attacker.example.com/collect',
    'http://localhost:3000/',
    'https://10.0.0.1/',
  ]) assert.equal(isAllowedPushEndpoint(e), false, e);
});

test('似せたホストを弾く', () => {
  for (const e of [
    'https://fcm.googleapis.com.evil.test/x',   // サフィックス偽装
    'https://evilnotify.windows.com/x',         // ドット無しの部分一致
    'https://push.services.mozilla.com.evil/x',
  ]) assert.equal(isAllowedPushEndpoint(e), false, e);
});

test('https 以外・ポート・資格情報付きは弾く', () => {
  assert.equal(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/x'), false);
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/fcm/send/x'), false);
  assert.equal(isAllowedPushEndpoint('https://evil@fcm.googleapis.com/fcm/send/x'), false);
});

test('URLとして壊れているものは弾く', () => {
  assert.equal(isAllowedPushEndpoint(''), false);
  assert.equal(isAllowedPushEndpoint('not a url'), false);
});
