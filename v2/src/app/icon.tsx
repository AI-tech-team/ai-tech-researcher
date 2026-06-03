import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// ブラウザタブ／ブックマーク用の32pxアイコン。ブランドのグラデ角丸＋「AI」モノグラム。
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          backgroundImage: 'linear-gradient(135deg, #0ea5e9, #4f46e5)',
          color: 'white', fontSize: 17, fontWeight: 700, letterSpacing: -1,
          borderRadius: 7,
        }}
      >
        AI
      </div>
    ),
    { ...size },
  );
}
