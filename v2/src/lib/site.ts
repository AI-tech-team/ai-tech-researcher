/** サイト全体で共有する公開メタ情報。layout / page / OG画像 / sitemap などから参照する。
 *  - SITE_URL は末尾スラッシュを除去（OG/canonical/sitemap の基点がブレないように）。
 *  - CONTACT_EMAIL は環境変数で差し替え可能（個人アドレス直書きを避ける。未設定なら空）。
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ai-tech-researcher.vercel.app').replace(/\/+$/, '');
export const SITE_NAME = 'AI Tech Researcher';
export const SITE_TAGLINE = '毎日「育つ」AIリサーチ';
export const SITE_DESC = '毎日「育つ」AIリサーチ — 最新動向を自動で集め、要約・分析・知識グラフ化してお届けします。';
/** 問い合わせ／データ削除依頼の窓口。Vercel に NEXT_PUBLIC_CONTACT_EMAIL を設定すると有効化される。 */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '';
/** プロトコルを除いた表示用ホスト（OG画像のフッター等で使う）。 */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '');
