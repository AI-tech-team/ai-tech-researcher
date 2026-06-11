/* AI Tech Researcher Service Worker — 起動高速化＋基本オフライン。
 *
 * 方針（鮮度を最優先・古い記事を絶対に見せない）:
 *   - ハッシュ付きの静的アセット(_next/static・アイコン・フォント等)= cache-first（中身不変なので安全）
 *   - HTML・RSC・データ・API = network-first（常に最新を取得。オフライン時のみキャッシュへフォールバック）
 *   - 書き込み(GET以外=Server Action/POST)・他オリジン・/api・認証は一切触らない
 *
 * 速度効果: 2回目以降の起動でJS/CSS/アイコンを再ダウンロードしない（モバイルのロード時間の大半を削減）。
 * 更新: バージョンを上げると activate で旧キャッシュを削除し、skipWaiting/clients.claim で即時反映。
 */
const VERSION = 'v1';
const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

self.addEventListener('install', () => {
  // 新SWを待たずに即アクティブ化（更新を素早く反映）
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 旧バージョンのキャッシュを掃除（古い静的アセットを残さない）
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

// ハッシュ付き＝中身が変わらない（=安全にcache-firstできる）アセットか
function isImmutableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon-') ||
    url.pathname === '/manifest.webmanifest' ||
    /\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                          // 書き込み/Server Actionは触らない
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // 同一オリジンのみ
  if (url.pathname.startsWith('/api/')) return;              // API・認証は常にネットワーク
  if (url.pathname.startsWith('/_next/data/')) return;       // データ取得は鮮度優先（触らない）

  // 静的アセット = cache-first
  if (isImmutableAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    })());
    return;
  }

  // HTML/RSC/その他GET = network-first（最新優先）→ 失敗時のみキャッシュ/オフラインシェル
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      // フルページ遷移のHTMLだけオフライン用に保存（記事データはRSC側で別途最新取得される）
      if (res.ok && req.mode === 'navigate') {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const cached = (await caches.match(req)) || (req.mode === 'navigate' ? await caches.match('/') : undefined);
      if (cached) return cached;
      throw err;
    }
  })());
});
