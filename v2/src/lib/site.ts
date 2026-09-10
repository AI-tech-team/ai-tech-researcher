/** サイト全体で共有する公開メタ情報。layout / page / OG画像 / sitemap などから参照する。
 *  - SITE_URL は末尾スラッシュを除去（OG/canonical/sitemap の基点がブレないように）。
 *  - CONTACT_EMAIL は環境変数で差し替え可能（個人アドレス直書きを避ける。未設定なら空）。
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ai-tech-researcher.vercel.app').replace(/\/+$/, '');
export const SITE_NAME = 'Cernoval';
export const SITE_TAGLINE = '読むべきものだけを、毎朝';
export const SITE_DESC = '毎日集まる大量のAI関連ニュースから、本当に読むべきものだけを選び、なぜ重要かを添えて毎朝お届けします。';
/** 問い合わせ／データ削除依頼の窓口。Vercel に NEXT_PUBLIC_CONTACT_EMAIL を設定すると有効化される。
 *  ⚠️ 未設定だとサイト上に連絡先が1つも無い状態になる。そうなると、権利者からの削除申し入れも
 *  本人からの開示請求も受け取れず、相手の次の一手が必ず法的措置になる（2026-09-10 監査）。 */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '';

/** 事業者としての表示事項。個情法32条1項・特商法11条・特定電子メール法4条で必要になる。
 *  有料化するまでは空でよいが、**課金を始める前に必ず埋める**こと（屋号だけでは足りない）。 */
export const OPERATOR_NAME = process.env.NEXT_PUBLIC_OPERATOR_NAME ?? '';
export const OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? '';
/** 巡回時に名乗るUAへ入れる連絡先URL。第三条（スクレイピングのマナー）。
 *  クロールはサーバ／パイプラインでしか走らないので、NEXT_PUBLIC_ でない SITE_URL も見る。
 *  SITE_URL 本体には足さないこと（クライアントで undefined になり canonical がずれる）。 */
export const CRAWL_CONTACT_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? 'https://ai-tech-researcher.vercel.app';

/** プロトコルを除いた表示用ホスト（OG画像のフッター等で使う）。 */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '');

/** フィードバック送信先（Googleフォームの formResponse URL）。
 *  例: https://docs.google.com/forms/d/e/XXXX/formResponse
 *  設定すると、サイト内のフィードバック欄からの送信が直接このフォームに記録される。 */
export const FEEDBACK_FORM_ACTION = process.env.NEXT_PUBLIC_FEEDBACK_FORM_ACTION ?? '';
/** 本文(段落)質問の entry ID（例: entry.123456789）。 */
export const FEEDBACK_ENTRY = process.env.NEXT_PUBLIC_FEEDBACK_ENTRY ?? '';
/** 返信用メール(任意・記述式)の entry ID。未設定ならメール欄は表示しない。 */
export const FEEDBACK_ENTRY_EMAIL = process.env.NEXT_PUBLIC_FEEDBACK_ENTRY_EMAIL ?? '';
