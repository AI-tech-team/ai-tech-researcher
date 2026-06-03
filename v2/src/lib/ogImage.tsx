/** OGP/Twitterカード画像をコードで生成（next/og の ImageResponse）。
 *  - opengraph-image.tsx / twitter-image.tsx から共通利用する。
 *  - 日本語フォント(Noto Sans JP)を必要グリフだけサブセット取得。取得失敗時は英語にフォールバックし、
 *    画像生成自体は必ず成功させる（共有が壊れないことを最優先）。
 *  - サーバー側fetchなのでCSP(ブラウザ側ポリシー)の影響は受けない。
 */
import { ImageResponse } from 'next/og';
import { SITE_NAME, SITE_TAGLINE, SITE_HOST } from './site';

export const OG_SIZE = { width: 1200, height: 630 };

// 表示する日本語コピー（フォントサブセットの対象もこれで決まる）
const JP_HEADLINE = 'AIの最新を、毎朝日本語で。';
const JP_SUB = '自動で収集・要約し、知識として蓄積していく。';

// 日本語フォントの取得に失敗したときの英語フォールバック（標準フォントで描画可能）
const EN_HEADLINE = 'The latest in AI, every morning — in Japanese.';
const EN_SUB = 'Auto-collected, summarized, and built into living knowledge.';

/** Google Fonts から、渡したテキストに含まれる文字だけをサブセットしたフォントを取得 */
async function loadJpFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=${encodeURIComponent(text)}`;
    const css = await fetch(cssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text());
    const fontUrl = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!fontUrl) return null;
    return await fetch(fontUrl).then(r => r.arrayBuffer());
  } catch {
    return null;
  }
}

export async function renderOgImage(): Promise<ImageResponse> {
  // 日本語版で表示しうる全文字をサブセット要求（ブランド名・URL等のLatinもNoto Sans JPに含まれる）
  const subset = JP_HEADLINE + JP_SUB + SITE_NAME + SITE_TAGLINE + SITE_HOST + 'AI0123456789';
  const jp = await loadJpFont(subset);

  const headline = jp ? JP_HEADLINE : EN_HEADLINE;
  const sub = jp ? JP_SUB : EN_SUB;
  const kicker = jp ? SITE_TAGLINE : 'Daily AI research that grows';
  const fontFamily = jp ? 'NotoJP' : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between', padding: '76px 84px',
          backgroundColor: '#03060f', color: '#f1f5f9', fontFamily,
          backgroundImage:
            'radial-gradient(circle at 0% 0%, rgba(56,189,248,0.20), transparent 42%),' +
            'radial-gradient(circle at 100% 100%, rgba(129,140,248,0.20), transparent 42%)',
        }}
      >
        {/* ── ブランド ── */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            width: 76, height: 76, borderRadius: 18, marginRight: 26,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundImage: 'linear-gradient(135deg, #0ea5e9, #4f46e5)',
            color: 'white', fontSize: 34, fontWeight: 700,
          }}>AI</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -0.5 }}>{SITE_NAME}</div>
            <div style={{ fontSize: 22, color: '#7dd3fc', marginTop: 4 }}>{kicker}</div>
          </div>
        </div>

        {/* ── 見出し ── */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.25, maxWidth: 1000 }}>{headline}</div>
          <div style={{ fontSize: 30, color: '#94a3b8', marginTop: 26, maxWidth: 1000 }}>{sub}</div>
        </div>

        {/* ── フッター ── */}
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, color: '#64748b' }}>
          <div style={{ width: 11, height: 11, borderRadius: 9999, backgroundColor: '#10b981', marginRight: 13 }} />
          <div style={{ display: 'flex' }}>{SITE_HOST}</div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: jp ? [{ name: 'NotoJP', data: jp, weight: 700 as const, style: 'normal' as const }] : undefined,
    },
  );
}
