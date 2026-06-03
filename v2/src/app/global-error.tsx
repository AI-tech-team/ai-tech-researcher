'use client'; // ルートレイアウト自体のエラーを受ける最終フォールバック。html/bodyを自前で持つ

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, background: '#03060f', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>問題が発生しました</h1>
            <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.7, marginBottom: 24 }}>
              一時的なエラーの可能性があります。もう一度お試しください。
            </p>
            <button onClick={() => reset()}
              style={{
                padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #0ea5e9, #4f46e5)', color: 'white',
                fontSize: 14, fontWeight: 700,
              }}>
              もう一度試す
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
