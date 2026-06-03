import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// iOSホーム画面用の180pxアイコン。iOS側で角丸マスクされるため全面塗り（透過の角を作らない）。
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          backgroundImage: 'linear-gradient(135deg, #0ea5e9, #4f46e5)',
          color: 'white', fontSize: 92, fontWeight: 700, letterSpacing: -3,
        }}
      >
        AI
      </div>
    ),
    { ...size },
  );
}
