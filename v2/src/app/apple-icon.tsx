import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// iOSホーム画面用の180pxアイコン。iOS側で角丸マスクされるため全面塗り（透過の角を作らない）。
// 32pxアイコンと同じブランド（グラデ＋光沢＋スパークル）。広い面積を活かしサブのきらめきを添える。
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', position: 'relative',
          alignItems: 'center', justifyContent: 'center',
          backgroundImage: 'linear-gradient(135deg, #6366f1 0%, #0ea5e9 55%, #22d3ee 100%)',
        }}
      >
        {/* 光沢ハイライト（左上から） */}
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex',
            backgroundImage: 'radial-gradient(circle at 28% 18%, rgba(255,255,255,0.45), rgba(255,255,255,0) 55%)',
          }}
        />
        {/* メインのスパークル（4点星） */}
        <svg width="104" height="104" viewBox="0 0 24 24" fill="#ffffff">
          <path d="M12 0 L14.6 9.4 L24 12 L14.6 14.6 L12 24 L9.4 14.6 L0 12 L9.4 9.4 Z" />
        </svg>
        {/* サブのきらめき（右上に小さく） */}
        <div style={{ position: 'absolute', top: 34, right: 40, display: 'flex' }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="rgba(255,255,255,0.92)">
            <path d="M12 0 L14.6 9.4 L24 12 L14.6 14.6 L12 24 L9.4 14.6 L0 12 L9.4 9.4 Z" />
          </svg>
        </div>
      </div>
    ),
    { ...size },
  );
}
