import { firstNonEmpty } from './env';

/** サイト全体で共有する公開メタ情報。layout / page / OG画像 / sitemap などから参照する。
 *  - SITE_URL は末尾スラッシュを除去（OG/canonical/sitemap の基点がブレないように）。
 *  - CONTACT_EMAIL は環境変数で差し替え可能（個人アドレス直書きを避ける。未設定なら空）。
 */
/**
 * 環境変数から最初の「実際に値が入っているURL」を選ぶ。末尾スラッシュは落とす。
 *
 * ⚠ `??` を使ってはいけない。環境変数は**未設定**と**空文字**の両方がありうる。
 *   GitHub Actions は未設定の secret を `SITE_URL: ${{ secrets.SITE_URL }}` で渡すと
 *   **空文字**として環境に入れるので、`??` では既定値に落ちず空文字がそのまま通る。
 *   朝刊配信ではその値が `new URL(siteUrl).hostname`（List-Idヘッダ）に渡り **例外を投げる**。
 *   例外は受信者ごとの try/catch に飲まれるので、**全員分の送信が失敗しても
 *   `[Brief] 朝刊配信: 0/N件` と出るだけ**になる（同じ形の事故は2026-09-10 にも起きている）。
 */
export function firstNonEmptyUrl(...values: (string | undefined | null)[]): string | null {
  const v = firstNonEmpty(...values);
  return v === null ? null : v.replace(/\/+$/, '');
}

/** 既定のオリジン。旧Vercelプロジェクト(ai-tech-researcher)は削除予定なので使わない。 */
const DEFAULT_ORIGIN = 'https://cernoval.com';

export const SITE_URL = firstNonEmptyUrl(process.env.NEXT_PUBLIC_SITE_URL) ?? DEFAULT_ORIGIN;

/** サーバ／パイプラインから見た基点。`NEXT_PUBLIC_` が無い環境（GitHub Actions）でも解決する。
 *  クライアントでは `SITE_URL` を使うこと（ここを使うと undefined 由来のズレが出る）。 */
export const SERVER_SITE_URL =
  firstNonEmptyUrl(process.env.NEXT_PUBLIC_SITE_URL, process.env.SITE_URL) ?? DEFAULT_ORIGIN;
export const SITE_NAME = 'Cernoval';

/** まだ一般公開しないので、サイト全体を検索インデックスから外す（2026-09-13 本人の指示）。
 *  公開するときは **この1行を false にするだけ**（next.config のヘッダと layout の metadata が両方これを見る）。
 *
 *  ⚠ robots.txt は `Disallow` にしない。クロールを止めると**クローラが noindex を読めなくなる**ので、
 *    既にインデックスされているページが消えない。「載せない」は allow + noindex で実現する。 */
export const SITE_NOINDEX = true;
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
export const CRAWL_CONTACT_URL = SERVER_SITE_URL;

/** プロトコルを除いた表示用ホスト（OG画像のフッター等で使う）。 */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '');

/** RSSリーダ/ブラウザ向けの自動検出リンク（<link rel="alternate" type="application/rss+xml">）。
 *  ⚠ Next.js のメタデータは**セグメント間で浅くマージ**される。ページ側で `alternates` を書くと
 *  （canonical を足すときなど）layout.tsx の `alternates` ごと丸ごと置き換わり、この行が消える。
 *  実測: canonical を足しただけで /articles・/about 等からRSSリンクが消えた（2026-09-12）。
 *  `alternates` を書くページは必ず `types: RSS_ALTERNATE_TYPES` を一緒に並べること。 */
export const RSS_ALTERNATE_TYPES = { 'application/rss+xml': `${SITE_URL}/feed.xml` };

/** フィードバック送信先（Googleフォームの formResponse URL）。
 *  例: https://docs.google.com/forms/d/e/XXXX/formResponse
 *  設定すると、サイト内のフィードバック欄からの送信が直接このフォームに記録される。 */
export const FEEDBACK_FORM_ACTION = process.env.NEXT_PUBLIC_FEEDBACK_FORM_ACTION ?? '';
/** 本文(段落)質問の entry ID（例: entry.123456789）。 */
export const FEEDBACK_ENTRY = process.env.NEXT_PUBLIC_FEEDBACK_ENTRY ?? '';
/** 返信用メール(任意・記述式)の entry ID。未設定ならメール欄は表示しない。 */
export const FEEDBACK_ENTRY_EMAIL = process.env.NEXT_PUBLIC_FEEDBACK_ENTRY_EMAIL ?? '';
