import type { MetadataRoute } from 'next';
import { SITE_NAME, SITE_DESC } from '@/lib/site';

// PWA マニフェスト（Next が /manifest.webmanifest として自動出力）。
// 「ホーム画面に追加」でスタンドアロン起動。アイコンは public/ の 192/512＋maskable512。
// 32px favicon / 180px apple-icon は app/icon.png・app/apple-icon.png（file convention）が担当。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESC,
    start_url: '/',
    display: 'standalone',
    // ⚠ 純黒にする。アイコン（C）の地も、.page の地も、起動スプラッシュも #000 なので、
    // ここだけ #03060f だと「ホーム画面から起動 → スプラッシュ → 紙面」の間で
    // 背景だけが僅かに青黒く浮く。viewport.themeColor（layout.tsx）と必ず同値に保つこと。
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
