import type { MetadataRoute } from 'next';
import { SITE_NAME, SITE_DESC } from '@/lib/site';

// PWA マニフェスト（Next が /manifest.webmanifest として自動出力）。
// 「ホーム画面に追加」でスタンドアロン起動。アイコンは public/ の 192/512＋maskable512。
// 32px favicon / 180px apple-icon は app/icon.png・app/apple-icon.png（file convention）が担当。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: 'Knowledge Tree',
    description: SITE_DESC,
    start_url: '/',
    display: 'standalone',
    background_color: '#03060f',
    theme_color: '#03060f',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
