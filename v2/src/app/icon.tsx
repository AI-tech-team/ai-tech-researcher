import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// ブラウザタブ／ブックマーク用の32pxアイコン。
// 角丸グラデ＋左上の光沢＋白いスパークル（AIらしさを小サイズでも視認しやすく）。
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', position: 'relative',
          alignItems: 'center', justifyContent: 'center',
          backgroundImage: 'linear-gradient(135deg, #6366f1 0%, #0ea5e9 55%, #22d3ee 100%)',
          borderRadius: 8,
        }}
      >
        {/* 光沢ハイライト（左上から）で立体感を出す */}
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', borderRadius: 8,
            backgroundImage: 'radial-gradient(circle at 28% 18%, rgba(255,255,255,0.5), rgba(255,255,255,0) 55%)',
          }}
        />
        {/* スパークル（4点星） */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#ffffff">
          <path d="M12 0 L14.6 9.4 L24 12 L14.6 14.6 L12 24 L9.4 14.6 L0 12 L9.4 9.4 Z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
