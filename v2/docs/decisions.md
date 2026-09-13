

# 設計判断ログ（Decision Log）

「**決めたこと**」と「**やめた案とその理由**」を、機能完成時に1段落で追記する。
目的: 半年後の自分/レビュアーが「なぜこうなっているか」を最短で復元できるようにする。
（セッションをまたぐ文脈は自動メモリ、コード単位の意思決定はここ、と役割分担）

書式の目安:
```
## YYYY-MM-DD タイトル
- 決定: 何をどうしたか。
- 理由: なぜ（制約・トレードオフ）。
- 不採用: 検討してやめた案と、やめた理由。
- 影響: 触る人が知っておくべき副作用/前提。
```

---

## 2026-06-07 公開ホームの初期フィードをSSR化
- 決定: `app/page.tsx`（サーバ）で非オーナー時に `getCoreData(30)` を取得し、PublicApp に `initialData` として渡す。initialData があればクライアントの `getCoreData` を叩かない。
- 理由: intercept 経由ページ（/about 等）から `/` へ遷移した直後、クライアントの Server Action がナビゲーション中断で abort され、ホームが空スケルトンで止まる事故を構造的に回避するため。Vercel⇄Turso 同リージョンでサーバ取得は速く TTFB 増は小。
- 不採用: 「クライアント取得をリトライするだけ」→ 2〜4秒のブレが残り、abort 連鎖も残る。SSR の方が堅牢。
- 影響: `/` は非オーナーで毎回サーバ取得が走る（オーナーは別UIのためSSRしない）。`loading.tsx` で遷移中の即時スケルトンを併用。

## 2026-06-07 情報ページ/記事/レポートを Intercepting Routes でオーバーレイ化
- 決定: 一覧からのソフト遷移は `@modal` の `(.)` インターセプトで全画面オーバーレイ表示。裏のトップは `children` スロットに保持。直リンク/リロードは従来のフルページ。
- 理由: 戻る度に一覧を再取得（数秒）していたのを解消（スクロール/状態保持）。
- 不採用: 状態のスナップショットだけ（`<Link>`化＋module snapshot）→ DOM 再マウントで再読み込み感が残った。
- 影響: 直リンク→トップ遷移で `@modal` 並列ルートの reconciliation により一時的な abort が出る（→ 上記SSR＋loadingで緩和）。

## 2026-06-07 公開レポートをホワイトリスト方式に
- 決定: `getReportsData`/`getReportById` を `type IN ('daily','weekly','monthly')` に限定（fail-closed）。
- 理由: 除外ブラックリスト方式で内部レポート `corpus_health`（コーパス健全度＝運用メトリクス）が ID 総当たりで露出していた。新しい内部種別が増えても既定で非公開にする。
- 不採用: ブラックリストに `corpus_health` を足すだけ → また新種別で漏れる。
- 影響: 公開対象を増やすときは明示的にホワイトリストへ追加する。

## 2026-06-07 dev/本番DBの分離
- 決定: Turso に `ai-researcher-dev`（本番複製）を作り、ローカルの `.env.local` を dev に差し替え（本番は `.env.local.prod.bak` に退避、両方 gitignore）。
- 理由: ローカルの検証スクリプト/dev操作が本番データを壊すリスク（VibeCoding 第四条）。
- 影響: 本番をローカルで触る時だけ `.prod.bak` に戻す。Vercel/GitHub Actions の env は本番のまま。

## 2026-06-10 オーナーUI(旧ダッシュボード)を撤去し全員を公開UIに統一
- 決定: `page.tsx` を常に `PublicApp` を返す形にし、`HomeClient`(OwnerDashboard)とオーナー専用タブ/モーダル14点＋RAGチャット(`/api/chat`/ChatPanel/MobileChatModal)を削除（計3,233行減）。`isOwner()` はサーバ権限(公開UIの rawContent 制限・各API保護)として温存し、収集/レポートAPI(collect/evolve/recategorize/report*)も cron 用に残す。
- 理由: 公開UI全面刷新方針(public-ui-overhaul)の発展で、オーナーも「読む」公開UIへ移行。運用トリガはcron委任で重複、チャットは個人用途のため廃止。dead な運用UIを一掃。
- 不採用: 知識グラフ/シグナル/自律リサーチの「公開UIへ昇格」→ シグナルは中身が薄く初見に響かない、知識グラフはエンティティ正規化の品質が公開に耐えるか未検証で今やる優先度に見合わない。塩漬けより撤去し、品質が育ったら公開ビューを新規作成する方が健全と判断。
- 影響: オーナーもログイン後は公開UIを見る(専用運用画面なし)。収集/レポート再生成は cron＋`CRON_SECRET` 直叩きで行う(UIワンクリックは廃止)。actions.ts の未使用オーナー専用アクションは下記で削除済。

## 2026-06-10 dead Server Action 28個を削除（オーナーUI撤去の後片付け）
- 決定: actions.ts から、オーナーUI撤去で呼び出し元が消えた28関数＋専用interface(SignalIntel/ProfileStats/EntityListItem)＋未使用importを削除（921行減）。
- 理由: `"use server"` は直接POSTで叩けるため、未使用でも攻撃面＋混乱の元（最小権限）。dead code を残さない。
- 不採用: 「UIだけ消してアクションは温存」→ 直POSTで叩ける面が残り、最小権限の原則に反する。
- 影響: 生存関数(getCoreData/getRecommendations/getEntityKnowledgePage等)・公開UI・API・cronは不変。ビルドで全削除の未参照を機械的に保証。pipeline_logs/alerts テーブルは将来用に温存（コード参照のみ削除）。

## 2026-06-10 Googleログインでアカウント選択を必須化
- 決定: `auth.ts` の Google provider に `authorization.params.prompt = 'select_account'` を追加。
- 理由: 未指定だと Google 側の既存セッションで選択画面を挟まず自動ログインし、別アカウントへ切り替えられない（ログアウト後の再ログインで意図せず別アカウントになる）。
- 影響: ログインのたびにアカウント選択画面が出る（単一アカウント時は素通り）。

## 2026-06-10 ②知識抽出の深さをDB状態で決める（DB主導化）
- 決定: `runKnowledgeExtraction` で、記事タイトルに登場する既知エンティティの「既存の主要クレーム＋90日以上未更新のベンチ」を `buildExtractionContext()` で集めて抽出プロンプトに重点ヒントとして注入。マッチ無し時は通常抽出にフォールバック。
- 理由: 同じ記事でも、矛盾・更新・新ベンチスコアを取りこぼさず精度を上げる（精度＞コスト）。軽量化分岐は入れない。
- 不採用: 本文(summary)一致でのマッチ→付随言及で誤発火しdry-runでノイズ確認→タイトル一致に限定。低確信度クレーム/重複も除外。
- 検証: dry-run(`scripts/_dry_extract_hints.ts`)でヒント品質、実抽出でリーク無し（注入値を転記せず記事内容のみ抽出）を確認。`EXTRACTION_VERSION`は据え置き（Batch遡及には乗せない＝確信度0.7リセット回避）。

## 2026-06-10 ①Epistemic Pull Collection は保留
- 決定: 「DB状態が収集クエリを生成」は今は実装しない。dry-run(`scripts/_dry_pull_queries.ts`)を再確認ツールとして残す。
- 理由: コーパスが新鮮すぎて燃料が無い（mention≥8は4件、45日より古いactive claimは2件、未更新ベンチ0件、記事の30日超は10件のみ）。高価値シグナル（確信度低下/ベンチ未更新）が空で、発火するのは手薄カテゴリだけ＝毎日同じgenericクエリでエコーチェンバー/低品質リスク。A〜EのDB精度向上でKBが健全化した結果、①の前提が今は不成立。
- 影響: 知識が古び始める将来に再評価。collectDataは無変更。

## 2026-06-10 日次レポートが生成されない不具合を修正
- 決定: `.github/workflows/run.yml` から `SKIP_DAILY_REPORT_EMAIL: '1'` を削除し、日次パイプライン(0 21=06:00 JST)がレポートを生成＋DB保存＋メール送信するよう戻す。
- 理由: SKIPは「外部cron→/api/report が06:00に生成する」前提だったが、その外部cronは存在せず（削除済・Vercel cronも無し）、かつ `generateReport()` はDB保存も担う関数のため、レポート行すら作られていなかった。
- 不採用: /api/report を外部cron(CRON_SECRET)で06:00駆動（厳密定刻だがenv設定が増える）→まず最小修正で復旧、定刻が要れば後で移行。
- 影響: レポートが復活（到着はGH cron遅延で朝7〜8時JST）。二重送信元は無いので競合なし。

## 2026-06-10 週次バックアップからユーザーPIIテーブルを除外
- 決定: `scripts/backup.ts` のダンプ対象から user系6テーブル(users/userProfiles/userArticleState/readingEvents/userTopicWeights/chatMemory)を外し、共有コーパス＋知識グラフのみに限定。
- 理由: バックアップは `v2/backups/` にコミット＆push＝git履歴に永久残留。退会の `deleteMyAccount`(ハード削除)が、履歴に残るPIIで無効化される穴（個情法の削除権／匿名性方針）。
- 不採用: PIIを匿名化してダンプ／バックアップをgit外へ→過剰。個人状態は再構築コストが低く除外で十分。
- 影響: 退会で個人データが完全消去される。バックアップから復旧できるのは共有資産のみ（個人状態は対象外）。併せて scratch スクリプト`scripts/_*.ts`をtsconfigの型チェック対象外に。

## 2026-06-10 アプリアイコンをバルブに刷新＋PWA化＋起動スプラッシュ
- 決定: モチーフ＝**バルブ(ひらめき/AI)＋新芽(毎日「育つ」)**。`src/app/icon.png`(32)/`apple-icon.png`(180)＋`public/icon-192/512/512-maskable.png` の静的PNG一式に置換し、コード生成の `icon.tsx`/`apple-icon.tsx` は削除。`manifest.ts`(standalone・bg/theme `#03060f`)＋layoutに`manifest`/`appleWebApp`配線。起動スプラッシュ`SplashScreen`(濃紺＋「新芽が育つ」インラインSVGアニメ=茎が伸び→葉が開き→種が灯る→fade-out)。当初はPNGロゴのscale-inだったが、"毎日育つ"を直球で見せる新芽アニメに差し替え(ユーザー選択)。
- 理由: モチーフ選定で星/スパークル/星座/Gemini系を一旦却下し（汎用的すぎる）、製品の芯「育つ知識」を直球で表すバルブ＋新芽に決定（ユーザー作成の1024 PNG採用）。PWA＝スマホでアプリ体験、スプラッシュ＝起動のブランド体験。
- 不採用: アイコンをコード(SVG)再現→ユーザー提供PNGの質が高く一式揃っていたので静的採用。iOSネイティブ起動画像→端末別画像が大量で重く見送り（アプリ内スプラッシュで代替）。毎回抑制(sessionStorage)→SSRと相性悪く一瞬チラつくので入れず（フルロードは稀なため許容）。
- 影響: 全サイズのアイコン＋PWA＋スプラッシュが本番反映（`/manifest.webmanifest`・各icon 200・head リンク確認済）。スプラッシュはJS無し/`prefers-reduced-motion`でも閉じ込めないフォールバック付き。`favicon.ico`は既に不在で一本化済。

## 2026-06-10 SEO土台: JSON-LD構造化データ＋sitemapにレポートURL
- 決定: `WebSite`+`Organization` をサイト全体(layout)、`/reports/[id]` に `Article` を付与（`JsonLd`コンポーネント=children方式で`dangerouslySetInnerHTML`不使用）。sitemapに `/reports/[id]` 直近分を追加。
- 理由: 公開前「配信・発見レイヤー」の土台。レポートは自前生成IPなのでArticle化、sitemapは記事のみで自前レポートが未収録だった穴を修正。
- 不採用: `SearchAction`(sitelinks検索box)→`?q=`のURL検索が無いので省略。記事ページに`NewsArticle`→第三者記事を自作と誤表示するので付けない。
- 影響: 本番でld+json妥当・sitemapの/reports/が0→37件を確認。次は②RSS/③per記事OG＋シェア(はてブ/X/コピー)/④メルマガCTA（計画はメモリ distribution-discovery-plan）。

## 2026-06-11 配信②: レポート全文のRSS 2.0フィード(/feed.xml)
- 決定: `app/feed.xml/route.ts`(Route Handler)で公開レポート(daily/weekly/monthly・最新50件)を `content:encoded` に全文配信。Markdownは**RSS向けの軽量セマンティックHTML断片**に変換（`[ID:N]`は`/articles/N`リンク化）。head に `rel=alternate`(metadata.alternates.types)、公開UIの「…」メニューにRSS導線。
- 理由: メール購読と同じ中身を機械可読で一本化（合意Q1）。レポートは自前生成IPなので全文OK、記事(第三者著作)は混ぜない。
- 不採用: メール用 `markdownToHtml`(api/report)の流用→暗色フルHTML文書でRSSリーダ(白背景)に不適。共通lib化も出力要件が別(暗色doc vs 白断片)なので見送り、フィード専用変換をルート内に持つ。記事をフィードに混在→著作権＆主役がぶれる。
- 検証: 本番200・`application/rss+xml`・37件・content:encoded全文・atom self・CDATA・CDATA外の裸`&`=0・home headのalternate出力を確認。CDNサイドキャッシュ`s-maxage=1800`。
- 影響: RSS購読が可能に。残=③per記事OG＋シェア/④メルマガCTA。

## 2026-06-11 RSS導線はhead自動検出に一本化＋重複dailyレポートを整理
- 決定: RSSの可視リンクを公開UIの「…」メニューから撤去し、head の `rel=alternate`(metadata.alternates)のみで配布（リーダ/拡張が自動検出）。本番の重複daily(同一report_date)6件を「最新生成1件残し」(方針A)で削除（紐づく adoption_logs 21件も先に削除）。daily 33→27。
- 理由: `/feed.xml`はブラウザ直開きで生XML表示＝初見ユーザーに壊れて見える（newcomer-first）。重複は cron二重発火/手動再生成の名残で一覧が冗長だった。
- 不採用: XSLでブラウザ整形ページ化→ChromeのXSLT廃止予告(2025)で非推奨。重複は「長い方を残す」案もあったが差は些少で最新版優先がシンプル。
- 影響: 削除6件は `scripts/_deleted_reports_backup.json` に全文退避（＋週次git backup）。**再発防止(日次レポ生成をreport_dateでupsert化)は未対応**＝cron二重発火で将来また重複しうる。気になれば後対応。

## 2026-06-11 Gemini予算キルスイッチ(請求自動停止)を本番構築
- 決定: 予算超過で**プロジェクトの請求を自動無効化**するCloud Function(gen2)を `ops/gcp-billing-killswitch/` に置き本番デプロイ。対象=課金が発生しうる唯一のproject `project-6f8c0b7f-7452-4e63-a48`(billing有効＋Gemini有効)。予算「Geminiキルスイッチ」¥2,000/月をこのproject限定で作成し `billing-stop` トピックに接続→関数が100%超過で `updateProjectBillingInfo(billingAccountName='')` を実行。
- 理由: Google Cloudに「$Xで止める」標準機能が無く、予算アラートは通知のみ。ユーザー要望「自動で止めたい」に対する唯一の金額キャップ手段（公式パターン）。実支出は当月≈¥90で¥2,000は約1/20＝通常発火せず暴走時のみ停止。
- 不採用: 方法1=APIクォータ(RPM/RPD)は即時だが金額でなく回数。今回は金額キャップ(方法2)を採用。両方併用が理想だがまずキルスイッチを構築。他の `gen-lang-*` projectは billing無効＝無料枠で課金不能のため対象外。
- 落とし穴: gen2はCloud Run上で動き、Pub/Sub(Eventarc)トリガの実行SAに `run.invoker` が**自動で付かず**配信が403で弾かれ続けた→Run serviceにrun.invoker付与で解決(READMEに必須手順として明記)。実行SAには `billing.admin` も付与。
- 影響: 公開前ブロッカーだった予算ガードが解消。発火すると**プロジェクト全体の請求OFF＝Gemini停止→日次パイプライン失敗**、復旧は手動で請求再リンク(READMEに手順)。予算データは数時間ラグ。既存¥300予算(全project/topic未接続)はアラート専用で温存。

## 2026-06-11 配信③: per記事/レポートの動的OG画像＋シェアボタン
- 決定: `reports/[id]`・`articles/[id]` に `opengraph-image.tsx` を新設し、`lib/ogImage.tsx` の `renderEntityOgImage({kicker,title,accent})`（既存 `loadJpFont` のNoto Sans JPサブセット流用）でタイトル＋カテゴリ/日付を描いた動的OGを生成。レポ=見出し抽出(本文先頭 `#`)＋エメラルド、記事=titleJa/title＋カテゴリ色。`ShareButtons`(client)を `ReportView` と `ArticleDetailContent` の末尾に配線（モーダル＋全画面の両方に出る）＝はてブ(add確認)/X(intent)/リンクコピー/モバイルnavigator.share。
- 理由: 合意Q3のシェア先(はてブ＋X＋コピー＋native)。OGはSNS/Slack/はてブのカード見栄えを決める拡散の要。レポートのOG/タイトルは自前IPなので全面OK、記事は**タイトル＋カテゴリのみ**(第三者rawContentは載せない=著作権配慮、一覧表示と同等の範囲)。
- 不採用: `twitter-image.tsx` 個別生成→X はog:imageにフォールバックするので重複ファイルを避け、レポにtwitter card type付与のみ(記事は既設)。`navigator.share`の有無は `useEffect`+setStateだとlint(set-state-in-effect)に触れる→`useSyncExternalStore`(server=false)でSSR非ミスマッチに読む。
- 検証: dev(:3001)で `/reports/75`・`/articles/4004` のOGが200・image/png・日本語フォント描画、両ページにシェア行表示をPlaywrightで確認。`tsc`/`eslint`クリーン。公開ページは内容不変なので `revalidate=86400` でISRキャッシュ(毎クロールでDB/フォントを叩かない)。
- 影響: 配信・発見章は ①SEO ②RSS ③OG/シェア 完了。残=④メルマガCTA。

## 2026-06-11 配信④: ログアウト訪問者にメルマガ価値を訴求(ウェルカム帯に統合)
- 決定: ④メルマガCTAは新規カードを足さず、既存のウェルカム帯(`welcomeOpen && !sessionUserId`・初回ログアウトのみ・一度きり)のコピーに「ログインすれば**毎朝のダイジェストをメールでも**受け取れます」を追記して訴求。ログイン後は既存の購読プロンプト(`subscribeEmailDigest`)が、設定は ProfileModal の購読トグルが担う。
- 理由: 購読導線は実は大半が実装済み(ログイン後プロンプト＋設定トグル＋subscribeアクション)。唯一の穴=ログアウト層に価値が見えない点。同じ場所に2枚目のカードを重ねるとnewcomer-firstに反し冗長なので、最も変換率の高い「ログイン判断の瞬間」=ウェルカム帯にメール価値を織り込む最小変更にした。
- 不採用: 独立した購読CTAカード(当初案)→既存ウェルカム帯と二重表示になり naggy。独立メルマガLP→計画どおり作らない(トップCTAのみ)。
- 影響: 配信・発見章 ①SEO ②RSS ③OG/シェア ④メルマガCTA すべて完了。`getMyProfile`/`updateMyProfile`/`subscribeEmailDigest` は既存のまま流用。

## 2026-06-11 PWAコールド起動のフリーズ修正(SSR初期取得をタイムアウト)
- 症状: インストール版PWAを起動すると「スプラッシュ画像のまま十数〜20秒フリーズ→その後ロード」。
- 原因: ルート `app/page.tsx` が `await getCoreData(30)` を**同期awaitしてからHTMLを返す**ため、コールド起動(Vercel関数ブート＋Turso初回接続)で最初の描画が丸ごとブロックされる。Service Workerも無く毎起動フルネットワーク。getCoreData自体は5クエリ並列なので遅いのはコールドスタートが主因。
- 対処: SSRの初期フィード取得を `Promise.race([getCoreData(30).catch(()=>null), 2.5s timeout])` で**最大2.5秒で打ち切り**、時間切れなら initialData=null でシェルを先に描画→クライアントがリトライ取得で後追い。ウォーム時は従来どおり initialData 付き(戻り時abort回避の最適化を維持)。空フィード不信用ガードも維持。
- 不採用(将来): Service Worker(app-shellキャッシュで再起動を即時化)＝依存追加とキャッシュ陳腐化リスクのため今回見送り。関数ウォームアップcronも保留。まずは描画ブロック解消を優先。
- 影響: 「20秒フリーズ」→「数秒で操作可能なシェル＋スケルトン→データ後追い」。コールド起動の体感が大幅改善。実データ到着までの時間自体(バックエンドのコールド)は別途SW/ウォームアップで詰める余地あり。

## 2026-06-11 ロードマップ①速度/PWA: Service Worker導入＋アバター<img>適正化
- 決定: 依存追加なしの手書き `public/sw.js` を導入し、`ServiceWorkerRegistrar`(本番のみ・load後登録)を layout に配線。戦略=**ハッシュ付き静的アセット(_next/static・アイコン・フォント)はcache-first / HTML・RSC・データ・APIはnetwork-first**(古い記事を絶対見せない)。skipWaiting+clients.claim+バージョン付きキャッシュ掃除。CSPに `worker-src 'self'` を追加。ヘッダのアバター`<img>`(Googleの24px外部画像)は寸法明示＋`referrerPolicy=no-referrer`＋理由付きeslint-disableに留めた。
- 理由: PWAコールド起動の遅さ([[debug-pwa-cold-launch-freeze]])の続き。SWで2回目以降の起動時にJS/CSS/アイコンを再DLしない＝モバイル体感を改善。データはnetwork-first厳守で陳腐化を回避(ユーザー合意)。アバターをnext/imageに通すとVercel画像最適化課金が乗る割に24pxでは無益＝コスト原則によりスキップ。
- 不採用: ナビゲーションHTMLのcache-first/SWR(=起動を完全に即時化)→キャッシュにSSR焼き込みの記事が残り陳腐化リスク。クライアント常時再取得はDB読取課金増。今回は安全側(静的のみcache-first)を採用。next-pwa/Serwist等の依存追加も見送り。
- 検証: 本番`next build`成功(全ルートコンパイル)。`next start`で /sw.js=200(application/javascript)、SW active(scope /)、リロードでcontroller制御中、**オフラインでシェル表示**をPlaywrightで確認。tsc/eslint/`node --check`クリーン。
- 影響: PWA再起動が高速化＋基本オフライン。残=Web Push(⑤)がこのSWを前提に乗せられる。次は②信頼/透明性。

## 2026-06-11 ロードマップ②信頼/透明性: 稼働状況ページ＋AI生成ラベル
- 決定: (a)`/status`ページ(＋`@modal/(.)status`インターセプト)を新設し、`getSystemStatus()`で**最新レポート/最新収集の時刻と件数**を公開。最新日次レポの日付とJST今日の差で健全性(正常≤1日/やや遅延=2日/遅延>2日)を導出。(b)`AiBadge`を新設しレポート(ヘッダ=「AI生成」)と記事サマリー(「AI要約」)に付与。(c)導線=「…」メニュー/フッター/aboutのFAQ＋フッター/sitemapに/status追加。ISR `revalidate=1800`。
- 理由: 方法論は既に`/about`がほぼ網羅していたため**新規methodologyページは作らず重複回避**(DRY)。透明性で不足していたのは「生きた状態(最終更新・健全性・規模)」と「実コンテンツ上のAI生成明示」だったのでそこに絞った。AI生成ラベルは誤情報の信用毀損リスク低減＋規約免責との一致。
- 不採用: 専用パイプライン実行ログテーブルの新設→既存の最新レポ/収集時刻で十分(差分最小)。`/how-it-works`新規ページ→/about重複。記事本文側のラベル→サマリーのみがAI生成物なのでサマリーに限定。
- 検証: 本番`next build`成功(/status・(.)status=静的＋ISR30分で生成)。dev実機で /status=200・健全性ロジック動作(dev DBは最新日次06-07で「遅延」赤表示=正しい/本番は毎日更新で緑)・収集件数表示、レポに「AI生成」・記事に「AI要約」バッジ各1をPlaywright確認。tsc/eslintクリーン。
- 影響: 信頼/透明性が公開ページに可視化。次は③発見の土台(URLページ化＋構造化＋検索facet)。

## 2026-06-12 ロードマップ③-A(1): エンティティの独立URLページ /topic/[name]
- 決定: 知識グラフのエンティティを独立URL `/topic/[name]`(＋`@modal/(.)topic`インターセプト)に。既存 `getEntityKnowledgePage` を流用(React `cache()`でmetadataと本体の二重実行防止)。関係先→`/topic/[other]`、関連記事→`/articles/[id]` を本物リンク化。BreadcrumbList JSON-LD付与。中身が空のエンティティは `robots noindex`(薄いページ量産を防ぐ)。
- 理由: 今までエンティティ詳細はモーダル(EntityPageModal)だけ＝URL無しで被リンク/共有/SEOに乗らなかった。最ユニークなSEO資産(競合に無い知識グラフ)を独立URL化。
- 不採用: 記事/レポと同じ ModalShell(中身のみ)ではなく、about/status と同じ OverlayShell(全ページ包む)を採用(/topicは独立した全画面ページなので)。
- 検証: dev実機 `/topic/Google`=200・関係/事実/関連記事表示・関係先/topicリンク9個・tsc/eslintクリーン。
- 残(③-A): ②`/category/[name]` ③`/tag/[name]` ④導線(エンティティchip/カテゴリ/タグを上記URLにリンク＝今はモーダルを開く実装)＋sitemap収録。導線が付くまで /topic は直リンク専用で孤立気味。

## 2026-06-12 ロードマップ③-A(2): /category・/tag URLページ＋導線＋sitemap
- 決定: `/category/[name]`・`/tag/[name]` の独立URLページ(＋@modal intercept)を追加。新規 `getArticlesByCategory`(category一致)・`getArticlesByTag`(tagsはJSON配列なので `LIKE '%"tag"%' ESCAPE` で含有判定)を5分キャッシュ・重要度→新着順。共通の `ArticleListView`(サーバ描画・記事カード→/articles/[id])で /category /tag を共用。BreadcrumbList＋ItemList JSON-LD付与・空はnoindex。
- 導線: `ArticleDetailContent` のカテゴリバッジ→`/category/[cat]`、タグ→`/tag/[tag]` を本物リンク化(記事を開けばそこから絞り込みページへ辿れる)。
- sitemap: 固定カテゴリ7種＋`getSitemapTopics`(関係を持つエンティティ最大300)を `/category` `/topic` として収録＝クローラ到達性を確保。
- 理由: ③発見の土台。エンティティ(/topic)＋カテゴリ/タグの絞り込みを全てURL化＝共有・被リンク・SEOに乗る。tagsはソース/ドメイン由来が多い(hn等)が機能は同一。
- 不採用: 記事カードの一覧UIはホームの既存コンポーネントを流用せず、SEOページ用に軽量な`ArticleListView`を新設(ユーザー状態・無限スクロール不要)。エンティティchip→/topic の在アプリ導線はPublicApp改修が要るため次段(今は記事のcategory/tag導線＋sitemap/相互リンクで到達性を確保)。
- 検証: 本番build成功(/topic・/category・/tag=動的ルート生成)。dev実機で /topic/Google・/category/LLM推論(80件)・/tag/hn(80件)=200・記事リンク・見出し確認。tsc/eslintクリーン。
- 残(③-A任意): エンティティchip→/topic の在アプリ導線。③-B: /search?q=＋ファセット。

## 2026-06-13 ロードマップ③-B: 検索URLページ /search?q=
- 決定: `/search?q=` のサーバ描画検索結果ページを新設。既存 `searchArticles`(title/titleJa/summary の LIKE・重要度→新着順・25件)を流用し `ArticleListView` で表示。検索入力は `SearchBox`(GETフォーム＝JS不要でサーバ再描画)。カテゴリバッジを `/category` リンク化＝簡易ファセット(クリックで絞り込み)。⌘Kの `SearchPalette` に「全画面で開く→/search?q=」導線を追加。
- 理由: ③発見。クライアント専用の SearchPalette は共有/履歴/SEO/no-JSに乗らなかった→URL化で補完。検索結果ページは **noindex**(薄い/無限ページのindex回避＝SEO定石)だが URL共有は可能。
- 不採用: ハイブリッドRAG(`hybridSearch`:vector+FTS+GraphRAG)はチャット/リサーチ用で重い→公開検索はLIKEで十分。期間/ソースの本格ファセットは見送り(カテゴリリンクで簡易代替)。/searchのintercept(モーダル)は付けず全画面遷移(検索は目的地ページ)。
- 検証: dev実機 `/search?q=Claude`=200・検索ボックス・25件・カテゴリリンク・⌘K導線。tsc/eslintクリーン。
- 影響: ③発見の土台は ③-A(topic/category/tag)＋③-B(search) が揃った。残=在アプリのエンティティ導線(知識グラフUI撤去で現状chip無し＝小機能新設)・期間/ソースfacet。次は④読む体験。

## 2026-06-13 ロードマップ④: 読む体験(読了時間＋目次)＋死にコード掃除
- 決定: レポート(ReportView)に**読了時間**(本文字数/450≒日本語の分速で概算)と**目次**(見出し3つ以上のときJS不要の`<details>`折りたたみ)を追加。`Markdown.tsx` に `extractHeadings`(# と ##)＋見出しへ `id=sec-{行番号}`＋`scroll-mt-20`(stickyヘッダ分のアンカーオフセット)。idは行番号ベース＝目次リンクと本文アンカーが必ず一致。**テーマ切替は保留**(色がダーク直書きで全面書換＝L工数・既に「ダーク固定で成立」判断)。
- 掃除: 到達不能な死にコード `EntityPageModal`(知識グラフUI撤去で入口消失・/topicが代替)を削除＋PublicAppの配線除去(commit 249fe98)。
- 検証: dev実機 /reports/75=200・読了時間/目次(5見出し)表示・目次リンクで#sec-4へアンカー遷移・tsc/eslintクリーン。
- 影響: 長文レポート(週次/月次)の回遊性向上。残(④任意): テーマ切替(L)・記事側の読了時間。次は⑤通知 or ⑥多言語。

## 2026-06-13 細かいギャップ補完: LINE/security.txt/skip-link/トップへ戻る/前後ナビ/ページネーション
- LINEシェア(ShareButtons・JP最大の共有先)／`public/.well-known/security.txt`(責任ある開示)／skip-to-contentリンク(layout＋PublicApp main#main-content)／BackToTopボタン(window>600pxで表示・モーダルは別スクロールで非表示)。
- レポート前後ナビ: `getAdjacentReports(type, reportDate)`で同種の前(古)/次(新)を取得→`/reports/[id]`全画面に「前の/次の{label}」リンク。
- /category・/tag ページネーション: `getArticlesBy*`に`offset`追加(PAGE_SIZE=40)、`?page=`で前後ページ送り(共通`Pagination`)。**2ページ目以降はnoindex**(薄い/重複ページ回避)。ArticleListViewに`paginationSlot`。
- 検証: dev実機で security.txt=200・LINEボタン・Tab先頭=skip・/reports/72前後ナビ・/category?page=2(前のページ/40件)。tsc/eslintクリーン。
- 残(選択ギャップ): **メールのワンクリック配信停止(unsubscribe・中規模)**／読書プログレスバー。次=unsubscribe→トピック別メール(⑤)。

## 2026-06-13 改名: AI Tech Researcher → Knowledge Tree
- 決定: プロダクト名を「Knowledge Tree」に改名（A方向＝「育つ知識」の世界観・新芽アイコンと一致）。`SITE_NAME`＋ハードコード全箇所（ヘッダ/OG・twitter alt/メール件名・送信者名/エラー通知/フィードバックmailto/knowledge-ai のsystem prompt/sw.jsコメント/CLAUDE.md/manifest short_name/crawler UA）を一括置換。SITE_TAGLINE「毎日「育つ」AIリサーチ」は継続（Knowledge Tree=育つ知識と整合）。
- 不採用候補: きょうのAI/AIブリーフ/AIめぶき/そだつAI。ユーザーがKnowledge Treeを選択。
- 保留: 独自ドメインは「最後」＝SITE_URL/UAの `ai-tech-researcher.vercel.app` は据え置き（ドメイン取得時に `NEXT_PUBLIC_SITE_URL` 更新＋OAuthリダイレクトURI追加）。
- 検証: dev実機で OG画像「Knowledge Tree」・ヘッダ・`<title>` を確認。build成功・tscクリーン。残ブランド旧名0。

## 2026-07-07 レポート統一・私用レポート撤去・06:00ちょうど配信
- 決定: 日次レポート生成を `src/lib/daily-report.ts` の `buildDailyReport()` に一本化（サイト掲載＝購読者メール＝オーナー手動再生成が同一実装）。対象記事を「前回daily以降の新着のみ」(20〜48hにクランプ)に限定し、前回レポートをプロンプトに渡して既報の焼き直しを禁止。旧実装(直近2〜7日を重要度順)は昨日の高スコア記事が再登場して新着を押し出す＝「毎日似たレポート・大事な新着が抜ける」の原因だった。
- 決定: 私用（オーナー宛メール専用）機能を削除 = 夜間調査一式(detectAlerts/問い生成/runNightlyResearch/briefing)・LearningRecap・cross_insight・`knowledge-ai.ts`(唯一の利用元が旧generateReport)。alerts/research_questionsテーブルは履歴として残置（生成停止のみ）。オーナー専用sendEmail(REPORT_TO宛daily/weekly/monthly/recap)も廃止し、全員が同一の「今日のダイジェスト」(emailOptIn購読)を受信。週次・月次はサイト掲載のみ。失敗通知メールは運用系として存続。
- 決定: 配信時刻の定時化。GitHub Actionsのschedule遅延(実測+40分〜1時間)対策として、フル実行を04:07 JSTに前倒し→同ジョブが21:00 UTC(06:00 JST)まで待機して `PIPELINE_MODE=report` を実行（リポジトリpublicでActions無料・外部cron不要）。フル実行失敗時も配信するalways()＋12:00の収集ランに「06:30以降で今日のdailyが無ければ生成・配信」の自己修復を追加。
- 不採用: 外部cron(cron-job.org)＝アカウント追加の運用負担、Vercel Cron(Hobby)＝時刻保証なし。/api/reportのCRON_SECRET経路は不要になり削除（オーナー手動再生成のみ残す）。
- 検証: tsc/next build/npm test(18件)クリーン。knowledge-ai残参照0。

## 2026-07-08 DB分裂の解消・原則6制定・スプラッシュ/速度/翻訳の改善
- **DB分裂(最重要)**: サイトが6/19で停止して見えた根因＝6月中旬の未記録DB移行でGH Actionsは新Tursoへ、Vercelは旧Tursoのまま（TURSO envが52日前から未更新）。ユーザー系テーブルの差分はゼロを確認（同期不要）→ Vercel本番envのTURSO_*を新DBへ更新し再デプロイで解消。/reports/176とホーム(8,742件)で実機確認済。教訓: DB移行はGH secrets/Vercel env/ローカル.envをセットで切替えdecisions.mdに記録。
- **原則6制定**: 「フロントは信用しない、バックエンドで全て検証」を行動原則に追加。違反していたトグル3Action(toggleFavorite/toggleReadLater/markAsRead)を修正: クライアントの現在状態申告を廃止しDBから読んで反転、副次効果(情報源スコア/興味学習/行動ログ)はON/OFF対称化＝連打での加点汚染を根絶。呼び出し側はサーバ確定値で楽観更新を補正。searchArticlesのLIKEワイルドカードエスケープ、id検証も追加。
- **スプラッシュ再設計**: 旧実装はJSタイマー＋visibility付きCSSで消す＝どちらもメインスレッド依存で、ハイドレーション中(実測3.5秒以上)凍結して居座った。サーバー描画div＋opacityのみのCSSフェード(コンポジタ駆動・0.8-1.15sで確実に消える)＋pointer-events:none常時＋sessionStorageゲート(同一セッション2回目は非表示・インラインscript)に変更。SplashScreen.tsx削除。※インラインscriptは静的定数のみでdangerouslySetInnerHTML例外を明記。
- **速度**: 本番実測 TTFB2.8s/FCP5.0s。主犯=getReportsDataが全レポート(176件)を本文込みで返しSSR/RSCペイロードが蓄積比例で肥大。直近40件×本文800字に変更(limit/contentCharsはサーバ側でクランプ=原則6)。feed.xmlは全文(contentChars=0)、sitemapは本文なしを明示指定。効果は本番デプロイ後に再計測。
- **翻訳**: 未翻訳2,542件の根因2つ＝①translateTitlesが80件/日で流入(50-100件/日)に負ける→200件/日に増量＋昼の収集ランでも150件回す ②窓が最新320行のみで古いバックログに届かない→全期間バックフィル(scripts/_backfill_titles.ts)で2,297件翻訳し残181件(製品名等の日本語化不能)。
- **運用**: Actions起動遅延が実測+1h49mで6:16配信になったため起動を03:07 JSTへ前倒し(バッファ約3時間)。/statusページ・導線・getSystemStatusを全削除。
- 検証: build/tsc/test(18)クリーン。スプラッシュはPlaywright時系列スクショで初回0.75s完成→1.15sフェード・2回目非表示を確認。
- **オーバーレイ背面スクロール**: 主因は`scroll={false}`の付け忘れ。Next.jsが@modalスロット(DOM上はフィードの後ろ)までウィンドウをスクロールさせ、記事を開いた瞬間に背面が900px→7,943px(最下部)へ飛んでいた。記事カードLink/router.pushにscroll:falseを付与。副次の2件も同時に解消: ①body{overflow:hidden}はiOS Safariが無視する→body{position:fixed;top:-scrollY}方式の共通フック`useScrollLock`(参照カウント・解除時にscrollTo復元)に統一 ②ModalShellにoverscroll-contain。OverlayShellが「ロックすると閉じた時に先頭へ飛ぶ」としてロックを諦めていた件は、位置復元により解決したのでロックを有効化。検証=Playwright(390x844)で開閉前後のscrollY一致・モーダル最下部まで送っても背面のbody.top不変を数値で確認。
- **オーナー限定APIの撤去**: 手叩き前提の運用エンドポイント6本(collect/evolve/recategorize/report/weekly/monthly・計730行)を削除。GitHub Actionsはdaily_pipeline.tsを直接実行しており、これらは死にコードだった(唯一の呼び出し元は破壊的ローカルスクリプトrefresh_all.ts=同時に削除)。残るAPIは/api/authのみ。
- **記事ページの薄さ(テスター指摘)**: 一般ユーザーに出るのがAI要約1段落(平均156字)だけで内容が伝わらない。抽出本文(rawContent)は著作権上公開できない(第三条)ため、本文の切り出しではなくLLMが書き起こした`key_points`(3〜5行)＋`why_matters`(1行)をcollected_dataに追加(migrate_v7_keypoints.ts)して記事ページに表示。フィードのカードもline-clamp-2→3。生成はflash-lite・日次220件(流入約190件/日を上回る量にしないと未生成が積み上がる)。※初回バックフィルを重要度順で回して古い記事から埋まり、新着100件中1件しか要点が無い状態になった→フィードは新着順なので生成順序も新着優先に修正。
- **英語要約の残存**: 英語のまま残ったsummaryが128件。翻訳の救済がタイトル(translateTitles)にしか無く、要約には無かった。translateSummariesを追加。走査窓が最新320行のみで古いバックログに届かない罠(タイトルで既知)を踏まないよう、バックフィル時は全件走査に切替え可能にした(128件→0件)。
- **コスト**: 実請求は1日¥9(月¥280)でキルスイッチ¥2,000の14%。Groundingは2.5系が1,500req/日まで無料で10req/日=課金ゼロのため「検索0%スイッチ」はコスト目的では無意味(精度で判断すべき)。収集時のLLM評価もfilterUnseenUrlsでURL重複除去済み。削減余地は「捨てる記事の要約を先に生成している」点のみで月数十円規模のため、精度>コストの方針に従い着手しない。

- **公開検索の作り直し(v9・2026-07-15)**: 旧`searchArticles`はクエリを丸ごと`LIKE '%…%'`で照合していたため、「AIの著作権問題」のような複数語クエリが構造的に0件になっていた(本番実測=正解既知20問でRecall@5=0%、有効クエリの80%が0件)。形態素解析+BM25の2レーン構成に置換し Recall@5=90% / nDCG@5=87%。
  - **設計は全て本番DB上のA/B実測で決定**(LLM審査によるnDCG@5 + 正解既知クエリのRecall@5/MRR。審査員flash-liteは1クエリ±11.7ptブレ→30クエリ平均で誤差±3ptと確定し、それ未満の差は採用理由にしない)。捨てた案: 自作n-gram辞書(Recall75%)/自作の複合語結合(-15pt)/分岐エントロピー+自作Viterbi(70%)/索引なしLIKE+IDF(35%)/RRF融合(効果なし)/語彙とPRFの順位融合(混ぜると悪化85→84)。手作りの分割器は全て汎用kuromoji(90%)に負けた。
  - **分割器**: kuromoji(IPADic・MIT)。ただしVercelには載せない(辞書15MBでコールドスタートが伸びる)。パイプライン(GitHub Actions)側でkuromojiを走らせ①記事を内容語に分割してsearch_tokens列に書く②語彙をsearch_vocabに書き出す。実行時(Vercel)はその語彙で最長一致するだけ(kuromoji不要でRecall同値=90%)。英数字(GPT-5.6等)はIPADicが粉砕するため解析前にU+E000で退避。
  - **索引**: search_ftsはFTS5(unicode61)。⚠外部コンテンツ(content='collected_data')にしたら"ai"等の高頻度語でbm25()が親テーブルを引き直し3,079ms→content=''のrowid直持ち+別JOINで57ms(54倍差・本番実測)。索引作成順序も罠: 空の索引にトリガを張った状態で既存行をUPDATEすると'delete'が「索引に無い行の削除」となりSQLITE_CORRUPT(本番で実際に踏んだ)→列を埋める→手INSERTで実体化→トリガの順。トリガ同期により「アプリの書き忘れで検索から記事が消える」事故を構造的に排除。
  - **2レーン**: 一致=語彙+BM25×重要度×新しさ、関連=PRF(擬似適合性フィードバック=語彙上位8件の既存ベクトルを順位減衰平均→近傍)。**クエリを埋め込まないのでGemini API呼び出しゼロ**=公開経路に課金・濫用リスクが出ない。融合すると両方悪化するので必ず別リスト表示。語彙分割不能なクエリ(例:アボカド)は無関係記事を並べず「該当なし」。searchAllで語彙検索は1回だけ実行し両レーンで共有。
  - **副次バグ修正**: runEmbeddingsの日次上限120→300。流入225件/日に対し120では毎日105件取り残され埋め込み保有率が下がり続けていた(直近30日66%/7日58%)=推薦・関連・意味検索が静かに劣化。欠損分だけ埋める非破壊のPIPELINE_MODE=embedを追加しバックフィル。
  - 検証: build/tsc クリーン。本番でトリガ健全性(追加/削除/整合性)・Recall・「該当なし」遮断・レイテンシをスクショと数値で確認。既存collected_fts(trigram・RAG用)は別系統で残置。

- **今日の注目＋Web通知(v9/v10・2026-07-15)**: フィードが新着順のみで重要記事(重要度9-10が約52本/日)が沈む問題に対し、外部調査(Techmeme/SmartNews等はriverの上に必ず数本置く)を踏まえ①トップに「今日の注目」を追加。`getTodayHighlights`が直近48h(薄ければ7d→30d)を重要度→新着で並べ同一ストーリーを畳んで6本返す。getCoreDataに同梱しSSR初期描画にも載る。LLMコストゼロ・既存列のみ・90sキャッシュ。旧「見どころ」は読み込み済み記事の重要度上位でスクロールにより古い記事が混じり重複もしていた。③retentionのためWeb Push(v10)。push_subscriptions(endpoint+暗号化キー・PIIなし・匿名購読可)にブラウザ購読を保存し、日次レポート生成時に`sendDigestPush`が全購読へ送る=**LLMコストゼロ・公開経路のGemini課金もゼロ**。VAPID鍵は公開鍵をクライアントに(公開情報)・秘密鍵はGitHub/Vercelのenvのみ(未設定なら送信スキップ=鍵設定前でもパイプライン無傷)。失効購読(404/410)は送信時に自動prune。トグルはServiceWorker/PushManager/Notification非対応やVAPID未設定なら自動非表示。iOSはPWA追加時のみ通知可。**「トピックのフォロー通知」はフェーズ2に分離**(follow表・エンティティページUI・新着マッチをパイプラインに足す必要があり、まずダイジェスト通知でretentionの核を通す判断)。検証: build/tsc/型クリーン、VAPID鍵ペア整合(実送信で410)、prune経路、本番migration適用。購読成功パスはheadless Chromiumが通知権限を常にdenyするため実機/実ブラウザでのみ検証可。原則6: 購読オブジェクトはzod検証+長さ上限+endpoint単位レート制限。

- **ロード高速化＋検索の段階表示(2026-07-15)**: 「全体的にロードが長い/上から段階的に出せないか」への対処。①**根因=Vercel関数が米国iad1実行・Turso本番は東京**でDBクエリ毎に太平洋往復(~180ms)していた(`x-vercel-id: hnd1::iad1`で確認)。→`v2/vercel.json`に`{"regions":["hnd1"]}`を追加し関数を東京固定(Hobbyでも単一リージョンは有効)。本番実測で`hnd1::hnd1`化、トップwarm~1.5s→~0.44s・検索cold~5.3s→warm~0.3s。トリビアルな変更で効果最大。②**検索の段階表示**: 旧`searchAll`は一致(語彙+BM25・速い)と関連(PRF意味検索・重い)を両方awaitしてから返すため関連が終わるまで一致すら描画できなかった。一致を`searchArticles`で先に描画し、関連は新設`searchRelated`をsearch/page.tsxの`<Suspense>`境界(RelatedSection)で後追いストリーム。未使用化した`searchAll`は撤去(cleanup-dead-code)。`searchRelated`は種取得にlexicalSearchを1回再実行するが**クエリ埋め込みなし=Gemini呼び出しゼロ**を維持。本番実測(warm)で一致リンク出現~0.43s/関連含め完了~0.8s、fallback「関連する記事を探しています…」でストリーム確認。トップのストリーム化(PublicApp一括取得の分割)はregion修正で体感が十分速くなったため優先度を下げて未着手。検証: tsc/build・本番のx-vercel-id/段階描画/スクショ(モバイル390)で確認。

- **v3ロード高速化: 索引＋上から順ロード(2026-07-16)**: 前回「トップのストリーム化は未着手」の続き。Phase0計測(scripts/_measure_coredata.ts・_explain_coredata.ts=読取のみ)でホームの主要4クエリ(corpus/highlights/activity/outlets)が全てcollected_dataを全走査(SCAN)＋一時B-treeソートしていると判明(EXPLAIN QUERY PLAN)。索引はURL一意とベクトルのみで、created_at/importance_score/story_idが無く、コーパス増(約50件/日)に線形悪化していた。→①**索引3本**(migrate_v10_indexes.ts・冪等)を本番に適用: idx_collected_created_at / idx_collected_importance_created(importance,created_at) / idx_collected_story_id。本番EXPLAINでSCAN→USING INDEX/COVERING INDEXへ変化を確認。索引はSQLiteが自動選択のためコード変更不要=デプロイ前でも本番が速くなる。②**上から順ロード(クライアント波分割)**: page.tsx(SSR)を getCoreData(30)→(12)にし「見た目の部分」だけawait、PublicAppのマウント取得を第1波(注目+レポート+件数+先頭12件)→第2波(getCollectedDataListでフィード全30件に差し替え)→第3波(統計/推薦=既存)に分割。belowFoldPendingで第2波中のスケルトン表示＋スナップショット焼付けを抑止(戻り時の12件固定化を防止)。**罠(実機検証で発見)**: 定数ABOVE_FOLDをpage.tsx(サーバ)が(use client)のPublicAppからimportすると実行時undefined→getCoreData(undefined)→limit=NaN→全件化しSSRが9MB/3553件に膨張。→page.tsxはリテラル12で保持(クロス境界importを排除)。検証: build/tsc/test(18)クリーン、本番DBでSSR=12件/150KB(9MB回避)を確認、Playwright時系列で12件先行描画→30件を確認。索引は本番適用済/コードは未デプロイ。

- **v3 Phase2 ベクトル精度: 意味的重複排除の是正(2026-07-16)**: 「ベクトルの精度改善」の着手にあたり本番DBを実測(`scripts/_measure_vectors.ts`=読取のみ・API不使用)。埋め込み保有率99.1%は健全で、**問題は埋め込みでなく重複排除(story)側**にあった。①**連鎖マージ**: 合流条件が「近傍が閾値内」のみで代表(canonical)との距離を見ておらず、新記事→近傍→その巨大ストーリーと数珠つなぎに成長。本番で160件・54日スパン(21日窓のはず)のクラスタが発生し、一覧/日次レポートは`seen.has(storyId)`で代表1件しか出さないため**別記事が黙って消えていた**(直近30日で1302件/23.9%が非表示)。→合流時に代表とも閾値内であることを要求し、ラウンド内クラスタも代表距離で検証。②**窓の基準が実行時刻**だったため過去記事の再グループ化で同時期の重複を照合できず単独化(dev実測: 解放246件が全て単独化)。→窓を「対象記事の日付±21日」に変更(日次実行は対象が新着なので実質不変)。③**閾値0.12→0.08**: 最近傍距離の中央値が0.11で56%が重複判定=分布の谷でなく密集帯に線があった。**不採用にした案**: 当初「連鎖だけ直して閾値は触らない」としたが、実測で本物の重複(IPO報道)0.074-0.118と別記事(Claude Code話題)0.090-0.120が**完全に重なり距離では分離不能**と判明。時間による分離も試したが代表からの日数差が中央4.6日 vs 5.0日で不可。距離帯サンプルで〜0.08=同一記事の重複収集/表記ゆれ(「Chatbot Arena + - OpenLM.ai」vs「| OpenLM.ai」)、0.10〜0.12=ほぼ別記事(d=0.108「Meta Is in Crisis」vs「Six search engines worth trying」)と確認し、**失敗の非対称性**(誤マージ=サイレントな記事消失/マージ漏れ=一覧がくどいだけ)で0.08を選択。代償として続報が続くニュースはまとまらない。根本原因は**埋め込み入力の痩せ**(title+要約=中央175字・1500字上限に0%到達。clampSummaryの6行制限が埋め込み入力にも効いている)でベクトルが「出来事」でなく「話題」しか表現できていないこと。再埋め込みはAPI課金のため今回は見送り(=[[next-session-agenda]])。④**日次上限150→400**(流入239件/日に対し滞留、3551件が未割当=埋め込み120→300で踏んだのと同じ罠)。⑤**`PIPELINE_MODE=restory`**を追加(既存ベクトルのみ使用でAPI課金ゼロ・冪等・途中落ちはstory_id=NULLが残るだけのfail-open)。GitHub Actionsのworkflow_dispatchから手動実行。⑥**日次レポートの「N媒体が報じた」を「同一トピックでN件」に修正**: storyCountは記事数で媒体数ではなく(story=655は160件だが実媒体6)、LLMがその誇張をレポートに載せていた=第三条(断定回避)違反。検証: tsc/build/test(18)クリーン。dev DBで全リセット→restory再実行し、内部矛盾246→0件・最大クラスタ41→17→(0.08で)9件・隠れる記事679→164件、境界(d=0.078-0.080)の統合ペアは8件中6件が正しい重複であることを目視確認。

- **v3 Phase3 コーパス精度: 本文抽出の試行記録＋キュー詰まりの解消(2026-07-17)**: 本文抽出率11.8%(1232/10466)が検索・推薦・重複排除の全部の天井になっていた(埋め込み入力の痩せ=Phase2の真因もここ)。本番実測(`scripts/_probe_extract.ts`等=DBは読取のみ・fetchはLLM不使用で課金ゼロ)で**4つ目の飢餓**を発見。①**キュー先頭の固定(未知の構造バグ)**: `runDeepExtraction`は`ORDER BY importance DESC LIMIT 25`のみで、fetch失敗した記事は`raw_content IS NULL`のまま翌日も先頭に居座り、25枠を毎回同じ失敗が食い潰していた。本番の先頭25件中**19件が7日前の同一記事**(=7日間再試行し続け)で、その裏の1041件は**一度も試行されずに7日窓を過ぎ永久欠落**(累計6512件)。証拠: `zenn.dev`は抽出成功率96%(実測)なのに1721件が未抽出＝失敗でなく順番が来ていない。→[[pattern-throughput-starvation]]の4例目。②**失敗理由がnullに潰れていた**: `fetchArticleText`は6種類の失敗(SSRF拒否/robots/非2xx/非HTML/短すぎ/例外)を全て`null`で返し、DBにも試行記録が無いため「枯渇で未試行」と「試行して失敗」を**区別できず**、直しても効果を測れない状態だった。→`fetchArticleTextDetailed`(理由タグを返す。既存関数はその薄いラッパー=DRY)＋列3本(`extract_attempted_at`/`extract_attempts`/`extract_error`・`migrate_v11_extract.ts`冪等・**push前に本番適用済**=第四条)。理由タグは集計前提でPII/本文を載せず、`too_short_37`のように記事ごとに割れないよう固定語彙にした。③**順序を「未試行優先」に**(`attempts ASC, importance DESC, created_at DESC`)＝詰まりの解消。恒久失敗(4xx/robots/非HTML/動画・GitHub)は上限を待たず即引退(attempts=9)させ枠を明け渡し、一過性(timeout/5xx)のみ3回まで再試行。試行不能なもの(url無し/対象外ドメイン)も**黙ってcontinueせず記録**する(未試行と区別するため)。④**上限25→300/日・7日窓は撤廃**: 流入は`imp>=7`で約150件/日に対し25件/日=6分の1しか処理できていなかった。試行記録が再試行の暴走を止めるので窓は不要になり、撤廃で6512件の滞留も回収可能に。`PIPELINE_MODE=deep`を滞留回収用に拡張(`DEEP_LIMIT`・冪等)しActionsのworkflow_dispatchに追加。**期待値は正直に**: 実測天井は`imp>=7`で**71.7%**(本番URL120件を実fetch)であり100%にはならない。失敗は恒久要因に集中=robots_disallow 18/120(ほぼReddit 975件・**第三条で尊重すべきもの**)、http_403 8/120(futurumgroup等のbot拒否)、unsupported_domain 5/120(YouTube/GitHubは本文が存在しない)。よって`imp>=7`で13.7%→約72%、全記事では11.8%→約60%(imp<7は対象外)が見込み。**撤回した自分の主張**: 途中でURLにHTMLエンティティ(`&#45;`)が混入した985件を「fetch必敗」と書いたが、実測は11/15成功(gigazineのサーバが許容・過去にも76件取得済み)で、失敗4件は403でエンティティとは無関係だった。URLの見た目で決めつけていた=[[prove-it]]。検証: tsc/lint(0 error)/test(18)クリーン、devでmigration冪等(2回目は全SKIP)、dev実動で2回目の実行が別の記事に進み恒久失敗21件が引退=詰まり解消を確認。


- **チャンクレーンをRRFから降格＝snippet供給専用に(2026-07-21)**: Phase3で本文抽出率を11.8%→69.7%に上げ`content_chunks`のカバーが11.7%→47%に増えたので、その成果を検証するため本番でA/B実測した(`scripts/_measure_chunk_lane.ts`・正解既知20問=`_z_queries.json`のknown・LLM審査不要の客観指標のみ)。結果は**改善どころか劣化**で、hybridSearchの3レーン構成はRecall@5=55.0%/MRR=0.307、チャンクレーンを外した2レーンは**85.0%/0.679**だった(-30pt)。**このレーンが単独で救えた正解は20問中0件**=利得ゼロで上位5の枠を平均3.32件占拠し正解を押し出していた。原因は2つに切り分けられ、①**RRFの重複加算**: 同一記事の複数チャンクが`chunkOrder`に重複して入り`addRrf`がそのぶん加算する(記事レーン/FTSレーンは記事IDがユニークで1回きり)ため、チャンク済み記事だけスコアが累積する=-15pt。②残り-15ptは**粒度の違いそのもの**で、本文断片は部分一致した記事を大量に浮上させるため、記事レベル30件と同格でRRFに混ぜる設計自体が誤り。→ランキングからは外し、`bestChunk`(=根拠段落のsnippet供給)だけを残す形に降格した。**不採用**: 重複除去だけ入れる案(A'=70.0%でまだ-15pt)、チャンクレーンの削除(snippetという本来価値まで失う)。修正後は実装そのもの(`hybridSearch`)を呼ぶ`scripts/_verify_chunk_fix.ts`でRecall@5=85.0%/MRR=0.679に復帰、snippetは78/100件で維持されることを本番で確認(再現コードでなく本物を測ることで計測と実装の乖離も排除)。**教訓**: カバレッジ(手段)の増加を成果と扱わない。チャンクを69.7%まで増やす作業は、この修正前は悪化を進めるだけだった。
  - **LLM審査による裏取り(`scripts/_judge_chunk_lane.ts`・審査条件はv9のA/Bと同一=gemini-2.5-flash・3票・提示順シャッフル・中央値・`_z_judge.json`にキャッシュ)**: known 20問は「タイトル/要約で特定できる記事を1件当てる」タスクでチャンクに構造的に不利な懸念があったため、realistic を含む44クエリで nDCG@5 を測り直した。結果は **A(修正前)87.1% → B(修正後)91.3% = +4.3pt** で、Recall@5の+30ptよりずっと穏やかだが**方向は一致**し、修正が改善であることが独立指標で確認された。**より正確な診断**: チャンクレーンが持ち込んでいた146件は平均関連度1.72(0=15%/3=32%)で、押し出していた側の220件は平均2.17(0=10%/**3=52%**)。つまり「チャンクはノイズ」ではなく**玉石混交で、置き換えた相手の方が明確に質が高かった**＝真因は等重量RRFで30件ぶんの枠を与えたことによる**過大評価**。146件中46件が最高評価だった事実から、将来ランキングに戻す余地はある(等重量ではなく重み減衰=RRFのKを大きくする/上位k件を絞る形で、同じA/Bで検証する)。今回は snippet 供給専用への降格に留める。

- **外形監視のためのヘルスチェック新設(2026-07-21)**: DBが全滅してもUIは`actions.ts`の各クエリが`catch → return []`でfail-openするため、HTTP 200＋「記事がまだありません」を返し外形監視から健全に見えていた(2026-06-19〜07-08のDB split-brain停止を19日間検知できなかった直接の原因)。→`/api/health`(`src/app/api/health/route.ts`)を新設し、①DB疎通＋記事の存在(down=500)②記事の鮮度③日次レポートの供給④ベクトル索引2本の生存(いずれもdegraded=503)を判定する。**`actions.ts`のfail-openは直さない**: 一部クエリの失敗で全画面を落とすのは表示挙動として退化するため、検知だけを別経路に出す判断。同じく`retrieval.ts`のチャンク検索も索引が壊れてもconsole.warnで続行するが、health側で索引を直接叩くことで可視化できるので触らない。**実測で設計が変わった点**: 当初`MAX(created_at)`で鮮度を見ようとしたが、この列に索引が無く全走査で**32秒**かかった(本番実測)。主キー降順の1行読みに変えて51ms、値が`MAX(created_at)`と一致することも確認済み。ベクトル索引の照会は1本3〜4.5秒で2本直列だと7.7秒に達するためPromise.allで並列化し`maxDuration=15`を明示。連打によるTurso読み取り課金は20秒メモリキャッシュで抑制(監視間隔は5分想定)。詳細(エラー文・最終更新時刻)は`isOwner()`限定で、匿名には各チェックのok/ngのみ返す(第一条=エラー詳細を出さない/運用情報の露出防止)。検証: tsc クリーン、ローカル実機でdev DB(古い)に対し`freshness:ng`→503 degradedが正しく出ること、キャッシュ切れ後の応答296msを確認。

## 2026-09-09 速度の根本原因＝索引欠落（ISR化＋本番DBに索引3本）
- 発端: ユーザーの「接続速度遅すぎ」。本番実測でトップは **コールド2.66〜3.83秒 / ウォーム0.18秒**、
  `/sitemap.xml` は **46.76秒**、`X-Vercel-Cache: MISS`・`Cache-Control: private, no-cache, no-store`。
- 原因①(配信): `page.tsx`→`getCoreData`→`getSourcesData(isOwner)`/`overlayUserState(currentUserId)` が
  cookies を読み、ページが動的レンダリングに落ちてCDNキャッシュを完全に捨てていた。トラフィックが薄く実質毎回コールド。
  → SSR専用 `getPublicCoreData()`(auth不使用) 新設＋ISR化。`?article=`/`?report=` は middleware で独立URLへ302
  （searchParams も動的化の引き金だった）。sitemap/reports/[id]/topic/[name] も同様にISR化。commit e0d42b0。
  **結果: 全リクエストが `X-Vercel-Cache: HIT`・0.21〜0.31s、sitemap 46.76s→0.41s。**
- 原因②(DB): `collected_data.created_at` に**索引が無かった**。EXPLAIN が `SCAN c / USE TEMP B-TREE FOR ORDER BY`＝
  **22,538件の全走査＋一時ソート**。コールド30〜47秒・ウォーム0.8〜1.5秒。
  `reports`/`claims` は索引ゼロ、`entities` は mention_count 索引なし。
  → 本番に3本追加: `collected_created_idx(created_at DESC)` / `reports_created_idx(created_at DESC)` /
  `entities_mention_idx(mention_count DESC)`。**articles LIMIT 12 が 861ms→11ms(78倍)、TEMP B-TREE 消滅**。
- 教訓: [[v3-roadmap-progress]] の「Phase1 速度改善=索引3本」は url/embedding/extract_queue の3本で、
  **実際に使われる `ORDER BY created_at DESC` を救う索引ではなかった**（[[pattern-coverage-is-not-outcome]] と同型）。
  記事数も 11,384→22,538 に倍増しており、全走査コストが増大していた。
- 副次: sitemap のトピック選定に ORDER BY が無く、載っていたのは**アルファベット順の先頭300件**
  (`01 AI`〜`Coinbase`)。`8VC`/`1010 Digital Works` を出す一方 `OpenAI`/`NVIDIA`/`Gemini` は1件も無し。
  → `entities` の mention_count 降順＋relations を持つ条件(EXISTS)に変更。
- 未了: **エンティティ正規化が公開に耐えていない**（`Claude`/`Anthropic Claude`/`Anthropic's Claude` が別物、
  `3.5 Flash` 等のバージョン断片、`CEO`/`China` 等の一般名詞、文字化け）。`/topic` を主役にする前の前提工事。

## 2026-09-09 エンティティ公開品質フィルタ（/topic・sitemap）
- 決定: `src/lib/entity-quality.ts` を新設し、公開面に出すエンティティを決定論で足切りする（LLM不使用）。
  ①mention_count>=2 ②一般名詞/地名/役職のブロックリスト ③文・40字超・文字化けの除外。
  適用先= `getSitemapTopics`（候補236→**223件**）／`/topic/[name]` は該当時 noindex。`EntityPage` に mentionCount 追加。
- 実測で落ちた13件（全て妥当・誤爆なし）: AI(m=42) / 既存のLLMスケーリング則(m=17) / LLMs(9) / China(8) /
  AI agents(5) / US(5) / AI demand(3) / Taiwan(3) / TSMC's CoWoS advanced packaging technology(2) /
  水冷CPUクーラー(2) / CLI(2) / EU(2) / CEO(2)。
- **撤回した診断**: 当初「エンティティ正規化が公開に耐えていない・Claude系が20個に分裂」と述べたが、実測で誤りと判明。
  統合可能な重複は **41件だけ**（所有格4 / 単複13 / ベンダー接頭辞41）で、`Claude Code`・`Claude Opus 4.8`・
  `Claude Fable 5` は**正しい別物**だった。包含関係(`OpenAI ⊂ OpenAI Codex`)も別物が大半で、
  [[current-phase-plan]] B の教訓どおり自動マージしてはいけないもの。
  真の問題は重複ではなく **mention_count=1 が81.5%(1,309/1,606件)** という低頻度の氾濫で、
  それが表に出ていた原因は sitemap のアルファベット順選定だった＝`ORDER BY` 修正が本丸だった。
- 残課題: `type` が全件 'model'（OpenAI/Nvidia/TSMC も company でなく model）＝分類が機能していない。
  `Anthropic Claude`↔`Claude`、`Fable 5`↔`Claude Fable 5`、`Opus 4.8`↔`Claude Opus 4.8` の重複は未統合。
  entity-quality のユニットテスト（第四条）は未作成。

## 2026-09-09 /topic の関係表示を撤去（LLM抽出の関係タイプが事実でない断定を出していた）
- **症状**: 本番 `/topic/OpenAI` の「関係」が「買収 → Anthropic / Apple / Google / Hugging Face /
  Microsoft / SpaceX / io Products / **マルタ**」と表示。OpenAIがこれらを買収した事実はない＝**虚偽**。
  国名まで買収対象になっていた。ベンチマークも `ExploitGym:1` / `exploit gym:100満点` / `ExploitGym:0` と
  同一ベンチが表記ゆれで重複し、スコアも意味を成していなかった。
- **決定**: 関係タイプ（買収/競合/性能で上回る…）の表示を撤去し、相手の名前だけを「関連トピック」として
  重複排除して並べる（説明文=「同じ記事で一緒に扱われたトピックです」）。リンクによる回遊性は維持。
  ベンチマークは表記ゆれで dedupe。
- **理由**: relations は [[current-phase-plan]] で自ら「信頼低（LLM抽出品質依存）」に分類していたのに
  公開面で断定として出していた。誤情報の公衆送信は信用毀損リスクがあり、CLAUDE.md 第三条
  （AI生成物は断定回避）に抵触する。第六条「障害時はまず止める」に従い、抽出側の是正を待たずに表示を止めた。
- **不採用**: 「関係タイプのホワイトリスト（competes_with だけ出す等）」＝どの関係タイプが信頼できるかを
  示すデータが無く、`acquired_by` 以外が正しい保証もないため。まず全部止める方が非対称性で正しい。
- **残課題**: ①抽出側で relation の向き・種別を是正（根本原因）②claims も文脈不明なものがある
  （「Belのパラメータ数: 10兆超」「agent misalignment incidents: two」）③ベンチマークのスコア正規化。

## 2026-09-10 知識グラフの品質是正（relations の向き・種別／claims／benchmarks／entities.type）
- **発端**: 09-09 に `/topic` の関係表示を撤去したときの残課題「抽出側の是正」。本番の生データを実測してから設計した。
- **relations の根因は2つ（本番854件を実測）**: ①型名 `acquired_by` が**受動名**なのに、LLMは subject に「記事の主役」を置く癖があるため**向きが定まらない**。実際、唯一事実だった記事「OpenAI、Onaを買収」も `OpenAI --acquired_by--> Ona` と逆に入っていた。②型が6種しかなく「開発元・製造委託・提訴・規制措置」の受け皿が無いため、企業間の関係が**すべて acquired_by に流れ込んでいた**（`AMD ← Nvidia` `Nvidia ← TSMC` `Apple ← Nvidia` `Cloudflare ← Cloudflare Turnstile` `Block ← Generative AI` `OpenAI ← マルタ`）。→ **全型を能動態に統一**し（subject が行為者）、`acquires` へ改名のうえ `develops` `supplies` `invests_in` `partners_with` を追加、プロンプトに向きの明示と正例・「どれにも当てはまらなければ抽出しない」を書いた。**不採用**: 既存 acquired_by 147件の向きを機械的に反転して救済する案＝サンプル30件中まともな行が0件で、向きだけでなく種別も誤っているため救済対象が定義できない。
- **決定論ゲートを新設** `src/lib/knowledge-quality.ts`（LLMも埋め込みも使わない・47ケースのユニットテスト付き）: `isValidRelation`（一般名詞/概念語/自己包含を除外）・`orderRelation`（対称関係を辞書順にして A-B と B-A の二重登録を防ぐ）・`isValidClaim`（推測伝聞・文になった述語・`= true` のような値でない値・一般名詞の主語を除外）・`isValidBenchmarkName`/`isValidBenchmarkUnit`（業績/作業量/運用指標、`52 x` `1.5 times` の相対倍率を除外）。**プロンプトの禁止事項は守られない前提で二重化**する方針（実測で `ヤコビ予想の反例を持つ可能性を示唆 = true` が通っていた）。`looksLikeEntity` 等は daily_pipeline.ts から移設した（同ファイルはトップレベル実行されるためテストから import できず、第四条を満たせなかった）。
- **ベンチスコアの捏造を止めた**: 旧 `normalizeBenchmarkScore` は 0<score<=1 を無条件に ×100 していた。ドライランで `Cursor Composer 2.5 / SWE-bench = 1` が **100%** に化けていたのを検出。ちょうど 1 は「1位/1点/1%/満点」の区別がつかないので**捨てる**（失敗の非対称性: 誤情報の公開 ＞ 情報の欠落・第三条）。0<score<1 は従来どおり ×100 し、`〜Bench/〜Eval` で単位なしのケースにも広げた（`Stanford LegalBench 0.823` → 82.3）。
- **entities.type が全1,620件 `model` だった**: `resolveEntity(rawName, type = 'model')` の既定引数がそのまま入り、呼び出し側が誰も型を渡していなかった。/topic のバッジで OpenAI も TSMC も「model」と表示されていた。→ `classifyEntityType`（既知リスト＋語形の決定論）を新設し、**判別できないものは 'model' と断定せず 'unknown'** にしてバッジ自体を出さない。再分類の実測は company 103 / model 183 / product 14 / benchmark 7 / unknown 1,309。**不採用**: LLMに分類させる案＝課金＋非決定的で、既知リストで足りる。
- **normalizeEntityKey が日本語を捨てていた（副次発見・実害あり）**: `[^a-z0-9]` で除去していたため、①`カインズ` `ソフトバンク` `マイクロソフト` はキーが空になり**エンティティとして登録できず**、②`既存のLLMスケーリング則` がキー `llm` になり**別物の `LLM` と同じノードに衝突**していた（canonical_name が前者の行に subject=`LLM` のclaimが入っていた）。→ かな・カナ・漢字・長音符を残す形に修正し、`runDataCleanup` で全エンティティのキーを再計算する（衝突する相手が既にいれば参照を付け替えてから統合）。本番ドライランでキー修正111件・統合0件。
- **`getEntityKnowledgePage` の取りこぼし**: claims/benchmarks を `subject = canonical` の完全一致だけで引いていたため、entity `Nvidia` に対し subject が `NVIDIA` のクレームがページから丸ごと漏れていた（SQLiteの `=` は大小文字を区別する）。→ `entity_id` で引き、名前一致は entity 未登録時のフォールバックにした。
- **表示側にも同じゲートを置いた**: DB クリーンアップ（日次パイプライン）を待たずに `tok/s` `unknown` `2026年売上高見通し 430億ユーロ` を公開面から消すため。第六条「障害時はまず止める」に沿う二重化。
- **本番への適用計画**: `runDataCleanup` の遡及適用（ドライラン実測: relations 854→647／benchmarks 466→338／claims active 2,858→2,453／entity key 111件修正）＋ `EXTRACTION_VERSION` を 2 に上げて Batch 再抽出。再抽出は `extraction_version DESC` 優先に変更した（未抽出16,584件が先に消化されると、いま誤りを出している1,760件の是正が1件も進まないため）。

## 2026-09-10 埋め込み入力に本文を混ぜる／reembed モードの致命的バグ修正
- **決定**: 記事ベクトルの入力を `title + summary`（本番実測で中央値175字・1500字上限への到達0%）から `title + summary + 本文冒頭`（上限2000字）に変更。Phase3 で本文抽出率が 11.8%→69.7% に上がり、[[debug-story-overmerge]] で判明していた「ベクトルが"出来事"でなく"話題"しか表現できない」痩せを解消できる材料が揃ったため。
- **バグ修正**: `PIPELINE_MODE=reembed` は全ベクトルを `UPDATE ... SET embedding = NULL` した後 `runEmbeddings(2000)` を**1回だけ**呼んでいた。本番は22,538件あるため、実行すれば2万件が embedding=NULL のまま残り**ベクトル検索から丸ごと消える**。未実行だったため顕在化していなかった。→ 完走するまで回すループに変更。
- **未実施（要GO）**: 実際の再埋め込みと A/B 実測。効果は必ず消費側の指標で測る（[[pattern-coverage-is-not-outcome]]）。ベースラインは既知の Recall@5=85.0% / MRR=0.679。

## 2026-09-10 ソフト404の解消（実測でメモリの記述を訂正）
- **実測でわかったこと**: `/articles/{欠番}` は 200 だが、**`<meta name="robots" content="noindex">` は入っており not-found UI も正しく描画されていた**。過去メモの「not-found.tsx が出ず 200 描画」は現状に当てはまらない。
- **原因は仕様**: `loading.tsx` によって本文のストリーミングが始まった後に `notFound()` が投げられるため、送信済みヘッダを 404 に変えられない（`node_modules/next/dist/docs` の loading.md「Status Codes」に明記。Next は代わりに noindex を注入するので**検索インデックスへの実害は無い**）。
- **決定**: ドキュメントが唯一示す方法「ストリーミング前に存在確認する」を middleware で行う。`/articles/:id` `/reports/:id` `/topic/:name` に限定し、実在しなければルート未定義パスへ rewrite して Next のルーティング層に 404 を確定させる。数値以外・桁あふれ・ゼロ埋めのIDはDBを引かずに404。存在確認は**正の結果のみメモリキャッシュ**し（削除された記事を「ある」と言い続けない）、DB障害時は **fail-open で通す**（一時障害で全記事を404にするのは退化・表示側の fail-open と同じ方針）。
- **不採用**: ①`loading.tsx` を削除してストリーミングを止める案＝スケルトンを失いUXが退行する。②`layout.tsx` で存在確認する案＝root `loading.tsx` があるため layout の await でもストリーミングが始まり効果がない（実際に確認）。
- **検証**: ローカル本番ビルド（後述の理由で `next build --webpack`）＋ `next start` で実測。`/articles/999999999` `/reports/999999999` `/topic/ZZZ_NOPE` `/articles/abc` `/articles/007` が **404**、`/articles/4204` `/reports/82` `/topic/OpenAI` `/topic/openai` が **200**、`/?article=4204` の302リダイレクトと `/articles/4204/opengraph-image` が無傷であることを確認。
- **ローカルビルドの罠**: 既定の Turbopack はプロジェクトパスに日本語（`ドキュメント`）が含まれると `start byte index N is not a char boundary` で**パニックして落ちる**。`next build --webpack` なら通る。Vercel 側はパスが英字なので影響しない。

## 2026-09-10 朝刊を「3分で読める」に収める（字数指示は効かない／構造で縛る）
- **前提**: 商品の約束は「忙しい人でも3分でAI動向を知れる」。読了速度は 600字/分（本人指定）。3分=1,800字。
- **実測で約束が破れていた**: 7日分を測ると全文 7分07秒〜9分26秒（平均8分25秒）、ハイライトだけでも 2分38秒〜4分08秒で**7日中3日が3分超**。プロンプトには既に「全体1500〜2000文字」と書いてあったが実際は 4,269〜5,655字（**約2.5倍**）で無視されていた。
- **本番データで4回試して分かったこと**:
  - 「1項目360字以内・全体4200字以内」と字数で指示 → ハイライト1本455字・全文9分01秒。全セクション超過。
  - さらに**実測値を突きつけて書き直させる** → 1本486字・9分07秒。**むしろ悪化した**。LLMは文字数を数えられないので、字数を突きつけても縮まない。
  - 「文の数・項目の数」で縛る → 全文2分44秒。ただし `### 見出し` が消え、記事タイトルの無い箇条書きになった。**落としてほしくない構造は明示的に必須と書く**必要がある。
- **決定**: `REPORT_SYSTEM_PROMPT` を字数指定から構造指定へ（ハイライト5点・各項目は `### 見出し` ＋3行・1行1〜2文・1文50〜70字、カテゴリ最大4つ、インサイト4項目以内）。**上限の数字はプロンプトに渡さない**。
- **不採用**: 「超過したら実測値を渡して書き直させる」リトライ。悪化させた上に毎日1回APIを余計に叩くため実装ごと削除した。
- **残したもの**: `SECTION_BUDGET` / `readableLength()` / `checkBudget()` は**監視専用**として残す。構造指定が効かなくなったときに沈黙して伸びるのを防ぐため、超過時は `console.warn` する。予算は読了時間から逆算（ハイライト1,800字=3分／+トレンド+カテゴリ別 3,000字=5分／+インサイト 4,200字=7分）。
- **修正後の実測**: ハイライト 1,398字=**2分20秒**（5本・1本276字）、全文 2,288字=3分49秒。全セクション上限内、`### 見出し` も5本すべてに復帰。テスト12件追加（境界・欠損セクション・3/5/7分の予算一致）。
- **副作用（未解決）**: 全文が3分49秒まで縮んだため、紹介ページで設計した「5分版／7分版」がほぼ中身の差を持たなくなった。3分の約束を優先した結果なので、段階を意味あるものにするには5分・7分の枠に足す材料（掘り下げ）が別途要る。

## 2026-09-11 紹介ページを「今朝の朝刊をそのまま置く」構成に／重要度★の撤去（決定④）
- **前提（コンセプトの確定）**: Cernoval は「非常に多いAIのニュースの中でも特に知っててほしいニュースを、読みやすく簡単にまとめて届ける。忙しい人でも3分でAI動向を知れるように」作られている。判断基準は**「読者の3分に貢献するか」**の1本だけ。自慢はしない、相手に必要なものを送るだけ。
- **決定（紹介ページ）**: 製品説明をやめ、**今朝の朝刊のハイライトを実物のまま**紹介ページに置く。「3分で読める」と書く以上は実測の秒数を出し、読み始めから読み終わりまでを IntersectionObserver で実際に計って見せる。数字は全て今朝の実データ（母数・掲載数・最大の束ね数）。
- **誇張の除去**: 最初に書いた10個の主張のうち**8個が実データで裏付けられなかった**（`_landing_audit.ts` で1つずつ照合）。SWE-bench の表は行を見たら `Cursor Composer 2.5 = 1（単位null）`、`SWE-Pruner Pro 3.8%` などで、出したら捏造になるため章ごと削除。「初出から4時間」の見出しラベルも、当該記事が 06:00 の配信より**後**に公開されていたので不可能だった。書く前に1件ずつ照合するまでは数字を出さない。
- **読了時間の単一実装**: `src/lib/reading-time.ts` に `CHARS_PER_MINUTE = 600` と `readableLength()` を集約し、`daily-report.ts` は再エクスポートに変更。生成側と表示側で測り方が分かれると「生成時は3分以内・表示は3分超」が起きる。
- **決定④（重要度★の撤去）**: 公開面から `★{importance_score}` を全て外し、`ObservedFacts`（「N本の記事が同じ件を報じた」「初出 M/D HH:MM」）に置換した。理由は実測: `importance_score` には**3つの互換性のない尺度**が同居している（LLM採点 4〜10 / HN由来は**全て8以上** / techdrip由来は**全て6以上**）。さらに日次レポートの並び順に対する寄与は隣接ペアの **2.2%** だけで、**80.7% は published_at** が決めていた。根拠のない数字を「AIが8点と判定した」ように見せていたので表示をやめる。**並べ替えのキーとしては据え置く**（内部の編集判断であって読者への主張ではない）。
- **取り残しを grep で洗った**: 表示を3ファイルにコピーしていたので共通コンポーネントに集約したが、それでも4箇所目（`/topic/[name]` の関連記事リスト）を取り残していた。機械的な `grep -rn '★|importanceScore'` で発見して同時に修正。「集約したから安全」ではなく、**集約した後に grep で0件を確認する**。
- **不採用**: ①3分/5分/7分/10分の段階版＝朝刊は1号3分と決めたので長さは1つだけ。「短い版と詳しい版を選ばせない」こと自体を約束にした。②`story_count` を「N媒体が報じた」と書く案＝実測で160件のstoryでも実媒体は6であり、記事数であって媒体数ではない。表記は必ず「N本の記事」。
- **実機で出た2つのバグ**: ①見出しが明朝で描画された＝`globals.css` の `h1,h2,h3 { font-family: var(--font-serif) }` は**要素セレクタ**なので CSS Module の `.page { font-family }` 継承に勝つ。`.page h1,...` で明示的に打ち消した。②読了タイマーが「0秒 で読了」＝紙面が短い日は開始マーカーと末尾マーカーが同時に視界へ入る。3秒未満は見積り表示のまま据え置く。
- **検証**: `npm test` 132件（`digest-highlights` 9件を新規追加、本番 id=316 の実データで 5本×3項目・ハイライト2分47秒を確認）、tsc/eslint クリーン、本番 https://cernoval.com/about をデスクトップ/モバイルで実機スクショ確認。

## 2026-09-11 トップを「今朝の朝刊」にする／記事の川を /articles へ降ろす／スプラッシュをCernovalのものに
- **発端（実測）**: 紹介ページ `/about` は黒地・Inter Tight・夜明けの版面で「毎朝3分・5本」を約束しているのに、
  その全CTA「朝刊を読む」の飛び先 `/` は**却下された旧デザイン**（明るい紙・明朝・紺）のままの旧 Knowledge Tree 一覧で、
  ログインバナー → 注目のテーマ → 今日の注目 → arXiv論文30本の川、だった。**商品の約束がトップで破れていた。**
- **決定**: `/` ＝ 今朝の朝刊そのもの（サーバーコンポーネント・ISR 5分）。川は `/articles` に降ろす。
  朝刊と役割が重なるもの（最新レポートのカード／週次月次カード／今日の注目／累計件数のストリップ／ログインバナー）は
  一覧から**外す**。選別は朝刊の仕事に一本化し、一覧は新着順の一本道にした。
- **版面の共通化**: `/about` 専用だった CSS Module を `src/styles/brand.module.css` に移し、トップ・過去の朝刊・紹介ページで共有。
  朝刊本文は `parseDigest`（`src/lib/digest.ts`）で構造に開いてから `DigestBody` が組む。**トップと `/reports/[id]` は同じ実装**
  （過去の号だけ別の見た目だと、リンクを踏んだ読者には別サイトに見える）。旧 `ReportView`（クライアント＋Tailwind）は撤去。
- **1本の左端に揃える**: 日付・大見出し・本文・奥付まで `--measure: 36rem` の同じ段に揃えた。
  見出しだけ画面左端・本文だけ中央、という状態は実機で読みにくかった。
- **順位は出さない（決定④の踏襲）**: ハイライトの区切りは罫だけで番号を振らない。号の頭に出す数字は
  「日付／読了時間（600字/分の実測）／N本からM本」だけ＝**数えれば出る事実**に限る。
- **実機で見つけた2つのデータ側のバグ**:
  ① **バックナンバーの本文が丸ごと消えていた**。ハイライトの3項目は 2026-09-10 のプロンプト改訂で `**ラベル**: 本文` になったが、
     それ以前の全レポートは `**ラベル:** 本文`（コロンが太字の内側）で、パーサが落としていた＝見出しだけが並んでいた。
     両方の形に対応し、ラベルが取れない行も**本文として残す**ようにした（欠落させない）。
  ② 古いレポートの文末に `（ID:4201, 4040）` `[ID:4189]` という**内部IDの参照**が混じっていた。読者には意味が無いので落とす。
     **リンクにはしない**——このIDは当時のDBの行を指しており今の記事IDと一致する保証が無い（誤リンク ＞ 欠落、第三条）。
- **オーバーレイをやめた（Nextの制約）**: 一覧を `/articles` に降ろすと、そこから `/articles/[id]` へ進む遷移は**親→子**なので
  インターセプト（`(.)`/`(..)` の両方を実機で試した）が効かず、記事は全画面ページになる。
  代わりに離脱時のスクロール位置を覚えて戻す実装を入れた（スナップショットにより再取得は元から無い）。
  root の `@modal/(.)…` は**別の枝**（`/privacy` 等）へは `/articles` からでも効くことを実測で確認したので残す。
  `@modal/(.)about` と `@modal/(.)reports/[id]` は、朝刊が1枚で読むものになったので撤去。
- **起動スプラッシュを差し替え**: 旧 Knowledge Tree の「球根から新芽が育つ」緑のアニメが改名後もそのまま残っており、
  **サイトを開いて最初に見えるのが旧製品のロゴ**だった。たくさんの点のうち5点だけが夜明けの色で灯る「選別」に変更。
  ⚠ 最初の版は**5点目が一度も見えなかった**（最後の点が灯り終わる 0.86s がフェード開始 0.78s より後ろだった）。
  遅延＋長さ ＜ フェード開始、という不等式をCSSにコメントで残した。
- **不採用**: ①トップに「全文を読む」を置いて朝刊を短い版／詳しい版に分ける案＝「長さは1つだけ」という約束に反する。
  ②内部IDを記事リンクにする案（上記）。③`/articles` にも「今日の注目」を残す案＝朝刊と違う5本が並ぶと、どちらが本紙の選別か濁る。
- **検証**: `npm test` 150件（digest 12件・digest-highlights 2件を追加）／`tsc` クリーン／`next build --webpack` 成功／
  ローカル本番ビルドで トップ・`/articles`・`/reports/[id]`（日次・週次）・`/about` をデスクトップ1440とモバイル390で実機確認／
  スプラッシュを4時点で撮影／記事への遷移と戻りのスクロール位置（1800→1800）を実測。

## 2026-09-12 「裏」の見た目をブランド語彙に寄せる（globals.css のトークン差し替え）

**決定**: `globals.css` が持っていた却下版（紙＝ベージュ・明朝・紺）のトークンを、表側 `brand.module.css` と
同じ語彙（純白／純黒・太いサンセリフ・藍＝`#4338ca` / 水色＝`#7dd3fc` の1色アクセント）に差し替えた。
これを見ているのは `/articles`・`/articles/[id]`・`/search`・`/topic`・`/privacy`・`/terms`・`/changelog`・
`/feedback`・404・エラー画面＝**表（朝刊）以外の全部**で、表と裏で別のサイトに見える状態だった。

**理由と方法**: 暗色決め打ちのTailwindクラスが公開UIに散らばっているので、**クラスは触らず変数側だけ**を差し替える
（塗り残しが原理的に起きない）。実測すると slate ランプは**文字色としてしか使われていない**
（`text-slate-*` 250箇所に対し `bg-slate-*` は2箇所）ため、950→700 を「地→最も薄い文字」として読み替えた。
⚠ 却下版の16進値をそのまま持ってくると**純白地では薄くなりすぎる**（`#a8a8b0` は白地でコントラスト約2.4:1）。
却下版がベージュ地で確保していた比率に合わせて薄い側を置き直した（500=`#6e6e77`／600=`#8c8c95`／700=`#c9c9d1`）。

**トークンで届かない分は最小限だけ手で直した**:
- **旧ブランドのロゴを撤去**（12ファイル）。青紫グラデのタイル＋`BrainCircuit`（＝Knowledge Tree 時代のアイコン）が
  裏側の全ページの左上に出ていた。表と同じワードマークだけにする。グラデは「巨大数字にだけ」という決定にも反していた。
- **主ボタンのグラデと色付きの影を撤去**（8箇所）。地の反転色で塗る（黒地には白／白地には黒＝`.btnSolid` と同じ）。
- 角丸は `--radius-*` を縮めた（16pxのガラスカード → ほぼ立った角）。`rounded-full` はTailwind側が無限大で持つので影響しない。
- 見出しの `font-family` を明朝から太いサンセリフへ。⚠ Tailwind v4 のユーティリティは `@layer` 内にあるため、
  レイヤー外のこの規則が `font-bold` / `tracking-*` に**必ず勝つ**（＝見出しは1箇所で揃う）。

**ついでに直した実バグ**: `:root[data-theme="dark"]` に `--rule-strong` / `--card-bg-hover` / `--accent-soft` /
`--shadow-hover` が無く、**「暗」を明示的に選んだ人だけ**が明のホバー色（暗い罫・白い面）を引いていた。
（`@media` 側には同じ4行が二重に書かれていた＝コピー時の取りこぼし。）

**削除**: `.article-row` / `.gradient-text` / `.btn-primary`（等幅・全大文字）/ `.sidebar-item` / `.stat-chip` /
`.live-dot` は却下版の意匠で、**公開UIからの参照が0件**だったので消した（残すと次に触る人が却下済みの語彙を再利用する）。
`.glass-card` は Skeleton が使っているので残し、すりガラス（blur）と影は落とした。

**不採用**: ①`/articles` の見出しを朝刊と同じ巨大サイズにする案＝一覧は二次的な面で、本紙の強弱を薄める。
②カードを罫だけの行に組み替える案＝トークンでなく構造の変更なので、別途提案してから。

**検証**: `npm test` 150/150・`tsc --noEmit` クリーン・`eslint` は既存の3件のみで新規0・`next build --webpack` 成功。
ローカル本番ビルドで `/`・`/articles`・`/about`・`/topic`・`/search`・`/privacy`・`/changelog`・404 を
デスクトップ1300とモバイル390、さらに明／暗の両テーマで実機撮影して確認。

## 2026-09-12（2）記事一覧を朝刊と同じ組み方にし、スマホの不具合を潰す

**決定**: `/articles` の版面を朝刊に寄せた。色と書体は前段のトークン差し替えで揃っていたが、
**構造が別物**（箱のカード／独自のヘッダ）だったため、まだ別サイトに見えていた。

- **ヘッダを共有**した。`BrandNav` に `right` スロットを足し、検索・メニュー・ログインをそこへ入れる。
  表（朝刊・紹介）と裏（記事一覧）が同じ黒いマストヘッドになる。
- **カードをやめて行にした**（`.river*`）。罫だけで仕切り、余白を広く取る＝朝刊の「過去の号」と同じ語彙。
- ページの頭を「小さいラベル＋大きい見出し」に（`Archive` / 記事を探す）。

**スマホで実際に壊れていたもの（実機で測ってから直した）**
1. **朝刊からどこにも行けなかった**。`@media (max-width:880px)` でナビのリンクを `display:none` に
   していたため、スマホでは上部が「Cernoval」だけ＝記事を探す/検索への導線が0本だった（リンクは
   描画されるが幅0px）。畳まずに詰め、それでも入らない幅では**フッタにもある**リンク（`minor`）から落とす。
2. **stickyナビが半透明で本文が透けていた**。`rgba(0,0,0,.74)` + `backdrop-filter` で組んでいたが、
   blur が効かない環境では白い紙面の文字がそのまま読めた。地を不透明の純黒にした。
3. 号のメタ行が折り返すと**区切りの点だけが次の行の頭に落ちて**「・230本から5本」に見えていた → 狭い画面では縦積み。
4. タップ目標が 28×28 / 34×30 px しかなかった → ナビの操作は最低 44×44、テキストリンクも上下 padding で 47px に。
5. **配色の切替がスマホから使えなかった**（`hidden md:flex`）→「…」メニューの中に入れて常に使えるようにした。
6. 「…」メニューのホバー開閉（`onMouseLeave` で遅延クローズ）を廃止。指にホバーは無く、
   タップ直後に合成される mouseleave で閉じる事故の温床にしかならない。外側タップは `pointerdown` で閉じる。

**⚠ 同じ罠を2回踏んだ記録**: Tailwind v4 のユーティリティは `@layer` の中にある。
CSS Module（レイヤー外）の `.navBtn { display: inline-flex }` は `hidden` / `sm:inline-flex` に
**必ず勝つ**ため、デスクトップとモバイル両方の検索ボタンが同時に出た。
幅の出し分けもモジュール側のクラス（`.navWide` / `.navNarrow`）でやること。

**測り方の誤り（撤回）**: 最初のプローブで「メニューが開かない／検索が出ない」と報告したが、
セレクタがフッタのリンクや別のボタンを掴んでいただけで、**どちらも正しく動いていた**。
`aria-label` / `title` で一意に取り直して確認した。

**検証**: `npm test` 150/150・`tsc` クリーン・`eslint` 新規0・`next build --webpack` 成功。
iPhone 13 相当（touch有効）で `/` `/articles` `/about` `/topic` `/search` の横はみ出し0、
ナビのリンクが 57×47 / 25×47 で見えること、ナビの地が `rgb(0,0,0)` であること、
記事へ出て戻ったときのスクロール位置 1500→1500、JSエラー0 を実測。

---

## 2026-09-12 — 画面を朝刊に一本化（A〜Fの実装）

**決めたこと**（本人の指摘6件とその場での判断）:

1. **上のバーを全ページ1つに統一**（A）。`BrandNav` から `links` / `cta` / `right` の引数を無くし、
   リンクも右側の操作（検索・…メニュー・アカウント）も**ページから変えられないようにした**。
   右側は新設の `BrandNavActions`（クライアント）が持ち、`/`・`/articles`・`/about`・`/reports/[id]`・
   `/topic`・`/topic/[name]`・`/privacy`・`/terms`・`/changelog`・`/feedback`・`/articles/[id]`・
   カテゴリ/タグ一覧の12箇所すべてが同じ実体を使う。
   理由: 「上のバーの要素がページごとに代わってうざい」。実際、朝刊は「記事を探す/検索/about」、
   記事一覧は「朝刊/トピック/about」、紹介ページは「選び方/約束＋CTA」、規約類は
   「ワードマーク＋トップへ」と**4種類**あった。引数で変えられる限り必ずまた散らばるので、
   引数そのものを無くすのが正しい直し方だと判断した。
   - 不採用: リンク配列だけ定数に切り出して各ページから渡す案。呼び出し側が上書きできる余地が残る。

2. **記事ページとカテゴリ/タグ一覧をブランド版面に**（B）。角丸カード＋枠線ボタンをやめ、
   罫で仕切る組みに統一（`.artShell` 系 / `.river` 系）。
   - ⚠ 実装中に踏んだ罠: 記事ページの外側に `s.page` を当てたところ、`.page` は**黒地固定**
     （朝刊のヒーロー用）なのに中身は `--text-main` などテーマ変数で色を取っていたため、
     明テーマで**黒地に黒文字**になった。読み物は読者のテーマに従わせる＝`s.page` を使わない。
     あわせて `BrandFooter` の色を `.page` のカスタムプロパティから literal に変えた
     （`.page` の外で使うと `var(--ink)` が未定義になり、地が透ける）。

3. **読了時間を号全体に統一**（C）。`/about` は `highlightsReadingSeconds`（ハイライトだけ）で
   測っていたため、同じ朝の同じ号がトップで「4分53秒」・紹介ページで「2分25秒」と表示されていた。
   `digestReadingSeconds`（号全体）に一本化し、使われなくなった前者は削除。

4. **朝刊の予算を「号全体で3分」に引き直した**（C）。旧: ハイライトまで3分／全文7分の積み上げ。
   ハイライト単体が3分に収まっていても号全体は4分53秒あり、約束と実物が食い違っていた。
   `SECTION_BUDGET` の合計を 1,800字 = 3分にし、構造指定も締めた（各項目1文・カテゴリ最大3つ・
   インサイト3項目）。**字数はプロンプトに渡さない**方針は維持（[[pattern-llm-cannot-count]]）。

5. **ハイライト5本を決定論で担保**（D）。生成後に `### ` を数え、5本未満なら
   「### 1.〜### 5. を全部出せ」と伝えて**1回だけ**再生成。それでも足りなければ短い号を出したうえで
   `logError(..., { alert: true })` でメール通知する。
   - 不採用: 字数のときと同じ「実測値を突きつけて書き直させる」。字数では悪化したが、
     **本数は数えられる形の指示**なので再生成に意味があると判断した。効かなければ通知で気づける。

6. **「注目のテーマ」を撤去**（E）。直近30件のカテゴリ内訳でしかなく、「何日以内の記事か」を
   説明できない数字を読者に出していた。カテゴリ絞り込みも同時に撤去。

7. **「あなた向け」を撤去**（F）。推薦・読書DNA・ペルソナ・興味/目標の入力欄・行動ログの書き込み
   （`reading_events` / `user_topic_weights`）まで一式。
   理由: 読了イベントは「お気に入り／後で読む／既読」の3操作でしか書かれず、普通に読んでいる人の
   中身がいつまでも変わらない＝動いていない機能だった。直すより外す（[[feedback-subtraction]]）。
   撤去した時点で、興味/目標と行動ログは**書くだけで誰も読まない個人データ**になるので、
   収集自体をやめた（第三条・PII最小化）。既存行は退会時の削除に任せる。
   残したのは「後で読む」への入口だけ＝第三者評価で価値が挙がった「見逃しを拾える」部分。
   プライバシーポリシー・利用規約の該当文言も実態に合わせて書き換えた。
   - 不採用: 読了イベントの記録点を増やして推薦を直す案。推薦のために閲覧行動を増して記録するのは
     匿名性方針とも逆向きで、商品の約束（3分で朝刊）にも効かない。

**検証**: `npm test` 151/151・`tsc` クリーン・`eslint` 新規0（既存2 error/2 warning据え置き）・
`next build --webpack` 成功。明/暗テーマの実機スクショ、iPhone 13相当で横はみ出し0、
「…」メニューの開閉、記事へ出て戻ったスクロール位置 1600→1600、JSエラー0 を実測。

**⚠ スマホのバーが2行に折れていた**（実機計測で発見）: 390px幅で「記事を探/す」「トピッ/ク」
「ログ/イン」と折り返し、バーの高さが250pxあった。`white-space: nowrap` と、
600px以下でログインをアイコンだけにして解消。ワードマークの当たり判定も 23px → 44px に広げた。

**⚠ ローカルdev DBに `key_points` / `why_matters` が無く**、記事ページが本番では出るのに
ローカルだけ404表示になった（[[reference-dev-env]] の逆向き＝dev が本番に遅れている形）。
`scripts/_fix_devdb_cols.ts` で dev にだけ ALTER TABLE して検証した。

---

## 2026-09-12 — 起動スプラッシュを「絞られていく」に作り直し

**決めたこと**: 輪郭のない、ふにゃふにゃした楕円のかたまりが最初にあって、
読み込みが進むにつれて**数が減り**、最後に1つだけ残る。
毎朝200本以上が流れてきて残るのは数本、という朝刊の仕事そのもの。

**やめた案（本人が却下）**: 1本の曲線を太さ違いで重ねる「流れから一筋を抜く」。
点は無くなったが**線**になっていて、指示は「曲線じゃなくて、輪郭のない楕円的なもの」だった。
その前の「7×4の点のうち5点を灯す」も、点が粒に見えて流れにならず却下済み。
→ **線でも点でもない、境界の立たないかたまり**が正解。次に触るときもここへ戻すこと。

**作り方**:
- 1つ1つは中心から外へ透明になる放射グラデーションの楕円＝**縁がどこにも立たない**。
- 9個を大きく重ねて置き、`mix-blend-mode: screen` で重なりを**明るさの足し算**にする。
  通常合成だと手前の楕円の縁が奥の中心を上書きして、かたまりではなく**円盤が並んで見えた**
  （実機のコマ撮りで確認）。
- ふにゃふにゃは、楕円ごとに周期（1.7〜2.8s）と位相をずらした `scale` / `translate` で作る。
  形そのものは変形させない。
- 減り方は外側から順（0.16s → 0.56s）。中心の1つだけ残す＝絞り込まれたように見える。
  最後の1つは濃くする（重なりが無くなるぶん、同じ濃さだと消えかけに見える）。

**維持した制約**: 動かすのは transform と opacity だけ（[[debug-pwa-cold-launch-freeze]]）。
SVGフィルタや path のモーフィングで「ふにゃふにゃ」を作るのはメインスレッド処理で、
ハイドレーション中（数秒）は必ず固まる。
タイミングの不等式も維持: **最後の楕円が消え終わる時刻 < フェード開始**（0.80s < 0.86s）。

**⚠ viewBox はゆらぎで膨らむぶん（最大1.18倍）を外に取る**。きつく切るとかたまりの縁が
箱で垂直に切れて、「輪郭が無い」という前提そのものが壊れる（曲線案のときにスマホで発覚）。
コマ撮りは `scripts/_shot_splash.mjs`（`document.getAnimations()` を pause して
`currentTime` を固定）。動きのあるものはスクショ1枚では検証できない。

## 2026-09-12 情報源の比率是正・巡回6回化・朝刊を★9以上に・メールの個人化を廃止

本人の指示は「情報源をもっと増やしていい／自動巡回をもっと増やしていい」だったが、先に実測したところ
**足りないのは本数ではなく比率**だった。流入は既に220本/日（14日3,079本・187ドメイン）あるのに
一次情報源は**2.8%**しかなく、朝刊の候補40枠の30%をノイズ源が占めていた（7日280枠を再現）。
この状態で足しても構図は変わらないため、順序を「外す→足す→下流の上限→巡回」に組み替えて提案しGOを得た。

**根因は重複登録**。`sources.value` に UNIQUE が無く、3箇所の insert が付けている
`.onConflictDoNothing()` が衝突対象を持てず全て空振りしていた。結果 itmedia topstory が**33行**、
monoist 6行、businessinsider 3行に増え、選択が `ORDER BY RANDOM() * (1 + score) DESC LIMIT 1` の
重み付き抽選なので、itmedia が他フィードの33倍引かれていた。有効rss 69行中42行がこの3つ。
`user_topic_weights.keyword` の UNIQUE 欠落で踏んだのと同じ型の2例目。
→ schema に `.unique()` を追加し、`ensureSources()` に既存重複の統合を入れ、
移行スクリプト `scripts/migrate_2026_09_12.ts` で本番の重複行を1行に潰してから UNIQUE index を張る。

**決めたこと**
- 外す: ノイズ源8フィードを `OFF_TOPIC_SOURCE_VALUES` で停止（「死んでいるから」ではなく「候補枠を食うから」外す点が `DEAD_SOURCE_VALUES` と違う）
- 足す: 候補40本をHTTPで叩き「200かつ item>0」だった**16本だけ**登録。落ちた分は登録しない
- 朝刊と知識抽出の候補を「★9以上、ただし一次情報源は★8から」に統一（`src/lib/primary-sources.ts`）
- 知識抽出: 1日窓を撤去し「まだ抽出していない記事」から選ぶ。上限10→60
- 巡回: 1日3回→6回（03:07/09/12/15/18/21 JST）
- 06:00メールの受信者ごとの記事出し分けを廃止（全員同一）

**不採用**
- `research.googleblog.com/atom.xml`（最新が2ヶ月前・feedburnerへ転送。既存の `research.google/blog/rss/` が上位互換）
- `qwenlm.github.io/blog/index.xml`（200で44件返るが最新が**1年前**）
- arXiv cs.LG / cs.CL の RSS（200だが item 0＝別形式）
- 深掘り抽出の閾値を★7→★6に下げる案（★6以下は本文あり0%だが、朝刊が★9以上しか使わないので拾う意味がない。本人の判断）
- 知識抽出を★8以上にする案。ノイズ除去後の流入は★8以上=81.6本/日で、上限60では**再び飢餓**になる（★9以上なら33.8本/日で、余剰26本/日が滞留3,033件の解消に回る）

**自分の誤りの訂正**
- 提案時に「キーポイント60→120、埋め込み300→500に上げる」と書いたが、あれは関数のデフォルト値で、
  実際の呼び出し側は既に `enrichKeyPoints(220)` / `translateTitles(200)` / `runChunkEmbeddings(250)` と
  引き上げ済みだった。実際に上げる必要があったのは知識抽出だけ。ノイズ源除去で流入が-32%になるため、
  差し引きのコストは**下がる**。
- ★9ゲートを「上位40枠の94%が既に★9以上なのでほぼ現状追認」と書いたが誤り。その★9枠の30%が
  ノイズ源だったため、同時に外すと★9以上の実数は1日22〜59本になり TOP_N=40 は埋まらない日の方が多い
  ＝実質的な変更。ただしハイライトは5本なので最も薄い日でも4倍の余裕がある。
- **プライバシーポリシーに「プロファイリングは行いません／記事の選別はすべての読者に同一」と書いたのは
  不完全な grep（`scripts/*.ts src/app/api` だけ見て `v2/daily_pipeline.ts` を見落とした）に基づく誤りで、
  本番に事実でない記述が出ている状態だった。**06:00メールは `readingEvents` の行動ログと
  `userProfiles.interests` で受信者ごとに並べ替えていた。今回これを廃止して記述側に実態を合わせた。

**残っている手（未実施・要GO）**
- 知識抽出を Batch API（既存実装 `batch_submit`/`batch_fetch`・50%オフ）に回す。06:00配信に間に合わせる必要がない処理なので前日ぶんを翌日に流せる
- 下流処理（翻訳200/要点220）も★9以上に絞ると 220件/日→40件/日 に落ちる。ただし記事ページ用に★8以下の要点が要るかは未確認

## 2026-09-12 メールが6:30着になっていた件（GitHub Actionsの起動遅延）→ 外部トリガ化

本人からの報告「最近ね。メール届くのが6:30頃」。約束は06:00。

**原因はパイプラインの遅さではなく `schedule` の起動遅延だった。**
`pipeline_logs.duration_ms` から起動時刻を逆算して実測（直近20日）:

```
cron '7 18 * * *'（03:07 JST のはず）の実際の起動: 遅延 中央値 +167分 / 最大 +482分
→ 起動 05:54 JST + パイプライン45分 = 終了 06:31 JST
朝刊の生成完了時刻も 8/27まで +1分 → 直近6日は +28〜50分 と一致
```

8月下旬は遅延+37〜47分だったので悪化し続けている。03:07起動では06:00まで173分しか無く、
遅延だけで食い潰される。**パイプラインを速くしても吸収できない**（しかも今日の変更で
知識抽出を10→60本にしたので所要はむしろ伸びる）。

**決めたこと**: `workflow_dispatch` は schedule の待ち行列に入らず遅れないので、
時刻の約束があるものだけ外部スケジューラから GitHub API で叩く。
- 外部トリガ: フル実行（03:07 JST）／レポート生成＋配信（06:00 JST）
- `schedule` のまま: 収集6回・週次バックアップ（締切が無い＝遅れても害が無い）
- 同ジョブ内の `sleep`（06:00まで待機）は不要になったので削除
- 手順は `docs/external-scheduler.md`。スケジューラは Cloud Scheduler（既存GCP・3ジョブ無料）を推奨、
  cron-job.org でも可

**不採用**
- Vercel Cron: フルは45分かかり Functions の上限（Hobby 60秒/Pro 300秒）を大きく超える。
  Hobbyのcronは「1日1回・時刻不正確」で今回の目的に合わない
- Cloud Run Jobs / Railway / Fly.io への移設: 実行時間制限は無くなるが、Dockerfile・secrets移設・
  ログ/失敗通知の作り直しが要る。症状は「起動が遅れる」だけなので釣り合わない
- cron時刻の前倒しだけで済ませる案（一度 '23 15'＝00:23 JST にして余裕337分を確保した）:
  中央値+167分なら間に合うが、最大+482分の日は依然として外す。外部トリガならその日も消える

**残るリスク**: 外部スケジューラが止まると週次/月次レポートが生成されない
（日次は12:17の回の自己修復が拾う）。PATの期限切れでも静かに止まるので、期限1年＋カレンダー登録。

## 2026-09-12 外形監査の是正① /category の17〜21秒と /topic の500

### /category/* が初回17〜21秒（7URL全部・4回再現）

`getArticlesByCategory` は category で絞り importance_score DESC, created_at DESC で並べるが、
`collected_data` に category の索引が無かった。本番の実行計画は `SCAN cd` ＋ `USE TEMP B-TREE FOR ORDER BY`
＝23,300行の全走査＋一時ソートで、**DB単体で13,853ms**（LLM推論=6,697件）。
`cached(..., 300_000)` はプロセス内メモリなのでインスタンスが変わると効かない。

→ `(category, importance_score DESC, created_at DESC)` の複合索引を追加（`scripts/migrate_2026_09_12b.ts`）。
`SEARCH cd USING INDEX` になり TEMP B-TREE も消えた。**13,853ms → 15ms**。
本番サイトの実測も **17〜21秒 → 0.18〜1.0秒**。

**監査の提案どおりに ISR を足さなくて正解だった**（下記）。`/category` は `searchParams` を読むので
そもそも静的化できないが、それ以前に日本語カテゴリ7件が全滅していた。

### /topic/* が6件 HTTP 500

Vercel のランタイムログに出ていた例外:

```
TypeError: Invalid character in header content ["x-next-cache-tags"]   (ERR_INVALID_CHAR)
```

Next はキャッシュ可能なルートに `x-next-cache-tags` を付け、暗黙タグに**デコード済みの pathname が
そのまま入る**（`next/dist/server/lib/implicit-tags.js` の `getImplicitTags`）。HTTPヘッダは Latin-1 までなので、
日本語や U+2011（`GPT‑5.6 Sol` のハイフン）が入ると Node が投げる。無効化する設定は Next 側に無い。

**実測で確定**: sitemap の topic 204件のうち「名前に非ASCII(>255)を含むもの」は**ちょうど6件**で、
500を返す6件と**完全一致**した。ASCII名の198件だけが生き残っていた。
ローカルの `next start` では6件とも200になる（Vercel のキャッシュタグ経路を通らないため）＝
**本番ログを見るまで原因に辿り着けなかった**。データを疑って entities/claims/benchmarks を比較したのは空振りで、
`水冷CPUクーラー`（空・500）と `Gemini`（空・200）が同じ形だった時点で「データではない」と切り替えるべきだった。

→ `/topic/[name]` から ISR（`generateStaticParams` + `revalidate`）を外した。
エンティティ名がそのままURLになる設計なので非ASCIIは今後も入り続ける。
代償のCDNキャッシュ喪失を許容した根拠: このページの6クエリ合計は24〜123ms、
同じく動的な /category は索引追加後0.18〜1.0秒。「198ページが少し遅い」より
「6ページが読者とGoogleに英語の500を返す」方が重い。本番実測で6件とも200（0.32〜1.97秒）、ASCII名も回帰なし。

**この制約は恒久的なルールとして残す**:
- `/topic/[name]`（エンティティ名＝非ASCIIあり）と `/category/[name]`（全て日本語）に **ISR を足してはいけない**
- 数値idの `/articles/[id]` `/reports/[id]` は ASCII なので ISR で問題ない

### ついでに直した索引
`claims`（3,097行）は**索引が1本も無かった**。知識抽出が10→60本/日に増えるので、
`(entity_id, status)` `(subject, status)` `(article_id)` を追加した。

## 2026-09-13 アイコンを Cernoval の C に刷新（commit `a7afa5e`）

**決定**: 形には意味を運ばせない。**C ひとつと夜明けのグラデーションだけ**にする。

**理由**: 旧アイコンは Knowledge Tree 時代の「バルブ＋新芽」(2026-06-10) で、改名後もそのまま
残っていた。差し替えにあたり「選り分け(cernere)」「新星(nova)」を絵にする案を5回作って全て却下された。
原因は道具（CSS／画像生成）ではなく、毎回**コンセプトの図解を作っていた**こと。アイコンは意味を
説明する場所ではなく識別する記号で、図解は情報量が多いため 32px で必ず潰れる。

**不採用にした案と、落とした根拠（すべて 32px の実測）**
- 三段のふるい（棒が多→少→1本）… 読み込み中のスケルトンUIに見える
- 点の面 5×5 から3点 … 32px で潰れて灯りが判別できない（192px では最も良かった）
- 地平線＋1本 … 選別に見えない
- 3×3 から1点 … 電卓・キーパッドに見える。そもそも「減って」いない
- 金の一点を足した C … 弧の塗り分けは結局ただの二色。点を足す案は 16px で消える

**採用案の性質**: グラデの軸を左下→右上（昇る向き）にすると**上の終端が自然に金になる**。
以前わざわざ足していた「金の一点」が、要素を1つも増やさずに出る。引き算として正しい形。

**実装上の決定**
- 書体に依存せず**円弧の幾何**で描く（`scripts/_export_icon.mjs`）。どの px でも同形を書き出せる。
  ⚠ SVG は y 軸が下向き＝角度が増える向きが画面上の時計回り。arc の **sweep-flag は 1**。
- 5枚とも**ベクターから各サイズを直接描画**する。512 を縮小すると 32px で輪郭が眠くなる。
- `icon.png`(32) のみ角丸＋角を透明。iOS/Android は自前でマスクするので他は正方形。
  maskable は絵を直径 64% に収める（安全域＝中央 80%）。
- `manifest.ts` の `background_color`/`theme_color` と `layout.tsx` の `viewport.themeColor` を
  `#03060f` → `#000000` に**同時に**変更。アイコンの地・`.page` の地・起動スプラッシュが
  すべて純黒なので、ここだけ青黒いと「ホーム画面から起動→スプラッシュ→紙面」で背景が浮いていた。
  片方だけ変えるとブラウザ UI と PWA スタンドアロン表示で食い違うため、2ファイルは常に同値に保つ。

**残した不整合**: `global-error.tsx`（クラッシュ画面）と `ogImage.tsx`（SNSカード）の `#03060f` は
別の面なので触っていない。揃えるかは別途判断。

---

## 2026-09-13 ⑤ 朝刊を3分に収める／ai_relevance の閾値を実測で決め直す

### 3分の約束（決定: 構成から重複を外す。削りは保険に回す）

`/about` は「3分で読める朝刊」と名乗っているのに、直近21号のうち **20号が3分超**だった
（最長 2026-09-04 の 9分26秒。号のページにその秒数がそのまま表示されていた）。

まず生成後に構造を機械的に強制する `enforceStructure()` を入れた（プロンプトが元から
指定していた「1項目1文」「カテゴリ最大3つ」等を、こちらで切る）。9分→3分半〜4分半まで
落ちたが3分以内は 2/21 止まり。**そこで削る前に「何が長いのか」を測った**のが分岐点。

- 「## 📊 カテゴリ別トピック」がハイライトの見出しと語を共有している割合 = **中央値100%**
  （実物でも「Agents API」「京セラ」がハイライトと📊の両方に出ていた）
- ハイライトの「実務への影響」は5本で **350字/号**。中身は見出しから導ける
  「開発者は〜すべきです」の定型で、5本中4本が💡インサイト節と1対1で対応していた

**この2つを構成から外すと 21/21号が3分以内に収まり、しかもトレンドもインサイトも全号残る。**
削り機構に頼ると 12/21号でインサイトが丸ごと消えていた＝毎日生成しては捨てていた。
「なぜ重要か」は商品の核（cernere＝選り分けて理由を添える）なので残す。

**不採用**: 超過したら実測字数を渡して書き直させる案。既に試して 455字→486字と**悪化**して
いる（2026-09-10・[[pattern-llm-cannot-count]]）。毎日1回APIを余計に叩いて悪くするだけ。

**正直に書いておく誤り**: 「実務への影響 は インサイト節の焼き直し」を bigram の重なり率で
示そうとしたが、実務26% / なぜ重要か21% / 何が起きたか19% で**分離できなかった**。
この判断の根拠は指標ではなく、対応する行を並べて読んだ結果である。

**保険として残した `fitToBudget()`**: それでも3分を超えたら、価値の低い順に構造を落とす
（📊 → トレンドを1文 → インサイトを2項目 → インサイト → トレンド）。**ハイライト5本には
絶対に触らない**。全部落としても超える号は短くする方をあきらめ、警告ログだけ残す（沈黙より露出）。
`TOTAL_BUDGET` はセクション上限の合計ではなく `3 × CHARS_PER_MINUTE` に固定した。
合計から導くと、セクションを1つ外すたびに読者への約束が勝手に縮む。

### ai_relevance の閾値（決定: 4 → 1。掛ける場所は「回復可能性」で切り分ける）

前日に足した列を全23,351件バックフィルして初めて分布が見えた。
0:12.2% / 3:12.3% / 7:22.7% / 10:52.8% で **4〜6 はほぼ空**＝「4で切れば良い」ように見えた。
**中身を見たら違った。**

- スコア3の無作為20件のうち **8件（40%）が本物のAI記事**
  （★10「Nvidia、OpenAI向け1000億ドル与信保証」/ NVIDIA Cosmos-H-Dreams /
  LG×Nvidia humanoid / Claude Code の利用上限 / Weights&Biases）
- スコア0は概ね妥当（観光モデルルート・ソロ航海・1993風FPS）。固有名詞を含む取りこぼしの
  密度は**スコア3の1/5**。例の「新潟駅徒歩圏…観光モデルルート」★9 は実測で rel=0 だった
- 4未満なのに**朝刊本文で言及された**記事が 32件

4 で切ると 5,704件（24.4%）が対象になり、そのうち1,000件以上が本物だった。**1 なら
対象は 2,839件（12.2%）で、取りこぼしの密度は 1/5 になる。**「4〜6が空だから4が自然」は
分布の形だけを見た誤りで、中身を見るまで分からなかった（[[prove-it]]）。

掛ける場所も切り分けた。基準は精度ではなく **外したときに回復できるか**:

| 面 | 掛ける | 理由 |
|---|---|---|
| 収集ゲート(`daily_pipeline.ts`) | ○ (6→**1**) | 落とすとDBに入らない＝復旧不能。6のままなら**約56本/日を永久に破棄**していた |
| 朝刊の候補プール | ○ | 外れても記事はサイトに残り、翌日も候補に残る |
| /articles・カテゴリ別・タグ別 | ○ | 検索と直リンクで必ず辿れる |
| **検索** | **×** | 探している本人に対して隠すのは検索の否定。判定のぶれが致命的になる |
| **トピックの関連記事・記事ページ** | **×** | 配ったリンクが後から404になる害のほうが大きい |

収集ゲートの `AI_RELEVANCE_MIN = 6` は前日の自分が
「**実測ではなくルーブリックからの逆算**（この数字だけは実データで振っていない）」と
コメントに明記して置いたもの。測ったら誤りだった。**測っていないと書いた数字は、
測れるようになった時点で必ず測り直す。**

**NULL は落とさない**（「AI無関係」ではなく「まだ判定していない」）。HN経路で本文が取れず
LLMに通せなかった記事が意図的に NULL で入る。

---

## 2026-09-13 ⑥ 「毎日成功して0件」を直す／健全性の指標を「呼ばれたか」から「生んだか」へ

### github-trending（決定: 窓を created:>60日 に切り、重複除去を絞り込みより先に）

`last_hit_at` は前夜まで更新されているのに、保存記事の最終は 2026-06-28（77日前）。
**毎晩APIを叩いて成功しながら、1件も保存していなかった。**通算11件のうち10件が初回の1日分。

原因は2つ重なっていた。どちらも単体では気づけない:
1. `sort=stars&order=desc` は**累計**スター順。毎日 tensorflow / transformers / ollama /
   AutoGPT という同じ殿堂入りリポジトリが返る。「Trending」という名前で、実際に測っていたのは
   流行ではなく**累計の知名度**。新規が出るのは「歴代トップ10入りしたとき」だけ。
2. `items.slice(0, 10)` で**先に絞ってから**重複除去していた。上位10件が既知になった瞬間に
   候補が空になり、以後ずっと0件（[[pattern-throughput-starvation]]）。

実測(2026-09-13)で窓を決めた:

| クエリ | プール | 未収集 | 新規/日 | 中身 |
|---|---|---|---|---|
| 現行（累計順） | 1,727 | **0/10** | 0 | tensorflow, transformers, ollama（全部既出） |
| created:>30日 | 44 | 44 | 1.5 | ⭐3,040 の印刷スキル等、弱い |
| **created:>60日（採用）** | 124 | 49 | **2.1** | ⭐7,783 kimi-k3-in-c, utopia, genoffice |

あわせて **0件でも必ず件数をログに出す**。この沈黙のせいで77日気づけなかった。

### reportSilentSources()（決定: 名指しするだけ。自動停止はしない）

根因は「`last_hit_at` を健全性の指標にしていたこと」。あれは**叩いたかしか見ていない**。
毎ランの最後に「有効なのに30日以上記事を生んでいないソース」を名指しする。

**不採用: 自動で status='stopped' にする案。**たまたま静かな週に良い一次情報源を殺す。
落とすかどうかは、名指しされたものを見てから人間が決める。

書いた直後に**8本**出た。一次情報比率が 7.4% しかない理由がここにある可能性が高い:

| ソース | 実測 | 見立て |
|---|---|---|
| blogs.microsoft.com/ai/feed | **410 Gone** | 死亡。DEAD_SOURCE_VALUES に追加（対応済み） |
| openai.com/news/rss.xml | 200・1,192件・最新当日 | blog/rss.xml と同一内容。重複で全落ち＝二重登録 |
| microsoft.com/research・engineering.fb.com | 200・最新が10〜13日前 | **更新頻度が取り込み窓(7日)より遅い＝永久に入らない** |
| magazine.sebastianraschka.com | 200・最新4日前 | 窓の中なのに0件。原因未特定 |
| calv.info・anond.hatelabo.jp・japan.cnet.com | 200 | 同上／そもそも題材でない可能性 |

窓が発行間隔より狭いと永久に取り込めない — [[pattern-throughput-starvation]] の別の顔。
一次情報源ほど発行間隔が長いので、**この窓は一次情報を狙い撃ちで落としていた**ことになる。

---

## 2026-09-13 ⑦ 一次情報を「集める」だけでなく「朝刊の枠を争わせない」／HFモデル・論文を収集に追加

### 先に、前節の自分の結論を撤回する

前節の最後に「**この窓（7日）は一次情報を狙い撃ちで落としていた**」と書いた。**これは誤り**。
沈黙していた8ソースのうち**7本は2026-09-12に登録したばかり**で、まだ一晩しか経っていなかった。
`reportSilentSources()` は「30日以上生んでいない」ではなく「登録以来ずっと0件」も同じ顔で拾う。
窓の狭さが原因だと示す証拠は無い。実際に窓切れで落ちていると確認できたのは
`microsoft.com/research` と `engineering.fb.com` の2本だけで、これは一次情報全体の話ではない。

### ① 朝刊の候補プールからだけ個人投稿系を外す（サイトには出す）

候補プール（★9以上）の**29.3%が個人投稿**だった（zenn 13.5% / reddit 7.7% / qiita 4.9%）。
★9が付いていた実物:

- 「52歳・下請け10年の私が、半年でコードを書かなくなった話」★9
- 「AIセキュリティ何から勉強すりゃええの？その4」★9
- 「Grok Botを使ってみた話と、1時間で開発組織ができた話」★9

良い記事だが**どれも「出来事」ではない**。importance_score が拾っているのは「よく書けている」であって
「今朝知るべき動き」ではない（「新潟駅徒歩圏で完結する1泊2日観光モデルルート★9」と同じ型）。

**決定: `DIGEST_EXCLUDED_HOSTS` を朝刊の候補クエリにだけ掛ける。**
収集も、一覧も、検索も、記事ページも一切止めない。止めるのは「今朝の枠を争う資格」だけ。
これは同日に決めた [[pattern-filter-by-recoverability]] に従っている
— 朝刊から漏れても検索で辿れる＝**回復可能**なので掛けてよい。収集ゲートには絶対に掛けない。

**不採用: 収集そのものを止める案。** 読み物としては価値があり、消すと検索でも二度と辿れない。

### ② Hugging Face のモデルと論文を収集する（新規コレクタ2本）

**モデルが公開されたこと自体が、AI朝刊にとって最も一次の出来事**なのに、一件も取っていなかった。

- `hf-models`: `sort=trendingScore` の上位30件 → DL1,000以上 or ♥100以上 → 未収集10件を評価。
  実測で `deepseek-ai/DeepSeek-V4.1-Flash` DL140,636 ♥2,024 / `Qwen/Qwen3.8-27B` DL7,726,687 ♥14,871 が並ぶ。
- `hf-papers`: `daily_papers` の上位30件 → 👍5以上 → 未収集8件を評価。URLは `arxiv.org/abs/{id}` に正規化。

**不採用: `sort=createdAt`（新着順）。** 実測すると DL0 のテストリポジトリばかりだった
（`tttoola/MyAwesomeModel-TestRepo` 等）。「新しい」は「起きた」ではない。

⚠ 現時点では**どちらの閾値も一件も落としていない**（30/30が通過）。実際に効いているのは
`filterUnseenUrls` と上位N件の切り出しで、閾値は「HFが静かな日に粗悪品を入れない」保険に過ぎない。
効いていない閾値を「効いている」と書かないために、ここに実測として残す。

### 25ソースの追加（候補82本 → 生存48本 → 採用29本）

一次情報源になりうるドメインを82本洗い出し、実際に叩いて生存48本、うち内容を見て29本を採用。

**不採用の理由を残す**: AWS ML Blog（AI以外の運用記事が過半）／Google AI Blog（research.google と重複）
／LangChain（自社製品の宣伝が主）／Nature（有料壁でタイトルしか取れない）／CNBC・MIT News（一次ではなく報道の要約）。

**保留（本人判断）**: ニュースレター5本（Simon Willison / Interconnects / Import AI / Last Week in AI / One Useful Thing）。
理由は本人の言葉のまま — 「業界の一次関係者ならいいけど、**その人の見解と一次情報を混ぜないように**。
あくまで業界であって、一次情報源とは敵対してるかもだから」。
**「出来事／報道／見解」の階層を持てるまで入れない。**今の朝刊は3つを区別できないので、入れれば必ず混ざる。

Anthropic / Meta AI / Cohere / DeepSeek / Groq 等34本は**そもそもフィードが無い**（Meta AI は robots で全面禁止）。
Mistral だけは隠しフィード `https://mistral.ai/news/rss` を持っていて、`discoverFeedUrl()` が見つけられる。

### ④ 商品説明の「要約」を「選り分け」に直す（5箇所）

商品は「要約装置」ではなく「読むべきものを選り分けて、要点を添えるもの」。
OG alt・記事descriptionのfallback・category/tagのdesc・利用規約§1を書き換えた。
**免責（「AI要約は誤りを含む」等）は事実なので触っていない。** 直したのは商品が何をするかの説明だけ。

### ⑤ user_topic_weights を落とす（本番31行 / dev 10行）

reading_events に続く2つ目の「読者の行動を貯める箱」。最終更新は2026-07-31で、
以後**誰も読んでいないし誰も書いていない**。持っている理由が無いものを持たない。
schema からは定義を消して「復活させるな」のコメントだけ残し、`deleteMyAccount` の削除対象からも外した。
マイグレーションは `scripts/migrate_2026_09_13_drop_topic_weights.ts`（`--dry` 可・接続先ホストを必ず印字）。

---

## 2026-09-13 ⑧ 法令の穴を2つ塞ぐ（外部送信規律・個情法32条）

本人からの問い「これは電気通信業なのか／法令的に大丈夫か」に対する調査と、その結果の反映。
**⚠ 弁護士の判断ではない。**条文と総務省・個人情報保護委員会の整理を読んだ上での作業であって、
最終的な適法性の判断は専門家に確認すること。

### 電気通信事業の届出は要らない（と考える）

電気通信事業法の「電気通信事業」の核は**他人の通信を媒介する**かどうか。
Cernoval は記事を集めて自分の要約を出しているだけで、ユーザー同士が通信する機能は無い
（お気に入り・既読は本人の中で閉じる）。メール配信も自分→購読者であって媒介ではない。

### ただし外部送信規律（法27条の12）は掛かる

**届出が不要な事業者にも適用される**のがこの規律の要点で、対象の一つに
「各種情報のオンライン提供（**ニュース配信**・気象情報・動画配信・地図等）」が明示されている。
Cernoval はここに当たる。

求められるのは「送信される情報の内容・送信先・利用目的」を**まとめて**示すこと。
これまで Vercel Web Analytics の説明は `/privacy` の「行わないこと」の節にあったが、
あれは**方針の宣言**で、規律が求める**開示**とは別物。重複して見えても、まとめた節が要る。

**決定: `/privacy` に「外部送信について（電気通信事業法 第27条の12）」を新設**し、
3件を並べた — Vercel Web Analytics（米国）／プッシュ配信サービス（Google・Mozilla・Apple 等）／
Google ログイン（米国）。プッシュのエンドポイント送信は、これまでどこにも書いていなかった。

### 個情法32条 — いま実際に義務を満たせていないのはこちら

保有個人データについて「事業者の氏名・住所」「利用目的」「開示等請求の手続」「**苦情の申出先**」を
本人の知り得る状態に置く義務。Cernoval は email/name/image を4人分持っている。
そして**サイトに連絡先が1つも無い**＝この義務を満たせない。

**「連絡先メールが無い」は不便ではなく、法32条の穴だった。**

条文には逃げ道がある — 「本人の知り得る状態（**本人の求めに応じて遅滞なく回答する場合を含む。**）」。
だから氏名・住所をサイトに常時掲示する必要はない。**ただし「求める」ための窓口は要る。**

**決定: `/privacy` に「保有個人データに関する事項（個人情報保護法 第32条）」を新設**し、
氏名・住所は「お求めに応じて遅滞なく回答します」と書いた。
⚠ `NEXT_PUBLIC_CONTACT_EMAIL` が未設定の間、この節は義務を満たさない。envを入れた瞬間に
`/privacy`・`/terms`・`/feedback`・ナビが一斉に点くところまでは既に配線済み。

### 検討して採らなかった案: ログインを廃止して個人情報をゼロにする（C案）

`users`/`user_profiles`/`user_article_state` を捨てれば**32条の対象そのものが消える**。
実測すると失うものはほぼ無い — 登録4人は全部本人のアカウント、配信ON 3人も同じ、
お気に入り合計8件・既読32件、最後の操作は2ヶ月以上前。RSS と Web Push（PIIゼロ）も既にある。

**それでも採らない。**この選択の本体は法務ではなく**配信経路の商品判断**だから。
「毎朝の朝刊」にとってメールは最も素直な経路で、Web Push は通知許可率とiOSの制約で代替にならない。
**法令対応のために配信経路を捨てるのは順序が逆。**

窓口メール1つ（A案）で32条・削除申立ての受け口・外部送信の問い合わせが同時に塞がる。
C案が正解になるのは「この朝刊はメールでは届けない」と決めたときで、そのときは半日で実行できる。
本人の判断は **A案＋住所はバーチャルオフィスを検討**（2026-09-13）。

⚠ 32条が求めるのは事業所住所ではなく「住所」。個人事業主がバーチャルオフィスの住所で足りるかは
未確認（特商法には明文の整理があるが32条は別条文）。**ここは断定していない。**

---

## 2026-09-13 ⑨ 一次情報がハイライトに1本も入らない／3分の器に1分50秒しか入れていない

⑦の構成変更を**本番データでプレビューして**（生成のみ・DB保存なし）見つかった2件。
どちらも⑦が作った問題ではなく、元からあって見えていなかったもの。

### A. LLMは一次情報を選ばない（実測 0/5）

| | 素材 | 選ばれたハイライト |
|---|---|---|
| 一次情報 | **8/15件**（NVIDIA開発者ブログ4・Together AI 2・Apple ML・Google） | **0本** |
| 報道 | 7/15件 | 5本（theverge×3・gigazine・technologyreview） |

LLMは「揉めている・金が動いた・人が辞めた」記事を選ぶ。**発表そのものは、放っておくと載らない。**
一次情報を2.7%から増やす配管を作っても、出口でこれをやられると紙面には出ない
（[[pattern-coverage-is-not-outcome]]: 上流を良くしても消費側の設計が誤っていれば利得ゼロ）。

**決定: 素材に `[一次情報]`/`[報道]` を明示し、「5本中最低2本は一次情報から」と指定する。**
材料のどれが一次情報かをLLMが知らなければ、本数を指示しても守りようがない。
字数は数えられないが**項目数は数えられる**ので、この形の指示は効く（[[pattern-llm-cannot-count]]）。

あわせて各項目に **出典**行（媒体名＋一次情報/報道の別）を足した。
本人の指示「**その人の見解と一次情報を混ぜないように**」への最初の一歩で、
読者の側からも、私の側からも、守られたかどうかを**数えられる**ようになる。
プレビュー再実行の実測: **5本中2本が[一次情報]**（NVIDIA / together.ai）。

**不採用: 一次情報専用セクションを決定論で組む案。**確実だが、OpenAI等の主要な発表も
一次情報なので、ハイライトから外れて格下の欄に落ちる。混ぜないのと格下げは別。

**⚠ 副作用**: 2本を強制した分、報道が2本押し出される。この日は Suno / Spotify /
NEC が落ちた。一次情報2.7%という現状に対しては正しい方向だが、**トレードオフである**ことは記録しておく。

### B. 3分の器に1分50秒しか入れていなかった

ハイライト785字 / 上限1350字＝**予算の61%**。⑤で長さを詰めた結果、短さが目的化していた。
**約束は「3分以内」であって「短いほど良い」ではない**（本人の言葉: 「1800字以内だったらいいのよ」）。

**決定: 「何が起きたか」を 1文 → 1〜2文**（2文目は数字・製品名・組織名などの具体に使う）。
`STRUCTURE['🔥'].bulletSentences` も 1 → 2。

**緩められる前提として、`fitToBudget()` に最終段「ハイライトを1文に戻す」を足した。**
それまで fitToBudget は 🔥 に触る手段を持っておらず、ここを緩めると受け止める網が無かった
（2026-09-10 の9分07秒が再演する）。本数5本は変えない＝削るのは密度であって品目ではない。

実測: 全文 1,100字(1分50秒) → **1,621字(2分42秒)**。ハイライト1本 154字 → 241字。
fitToBudget は発火せず、生成が最初から収まった。

**⚠ Bの「61%」は n=1、しかも新着窓が半日しかない状態の測定である。**
実際の04:07ランは24時間窓なので素材も本文も増える。一般的な性質として扱わないこと。
明日の実物で測り直す。→ [[pattern-tests-from-observed-failures]]

---

## 2026-09-13 ⑩ 記事の要約が別の記事のものになっていた（位置で突き合わせていた）

`/articles` の第一画面を測りに行って、**別の不具合を見つけた。**本番で実際にこう出ていた:

```
題: ActReview：アクション可能なピアレビュー生成のための、反論ガイド付きトレーニングデータ
要: 本研究は、ROS 2におけるDDSのバックプレッシャー問題を解決する「Adaptive Bridge」を提案する

題: 多言語の架け橋を築く：In-Language Reasoningの汎化におけるデータ混合の重要性
要: 本研究では、行動指向のピアレビュー生成タスクを定義し、診断的クレーム生成と…

題: Adaptive Bridge：ROS 2におけるDDSバックプレッシャー緩和のためのプロキシベース
要: 本研究は、数理論理ソルバーに依存するニューロシンボリックシステムにおける…
```

**きれいに1つずつ回転している。6件中3件が別記事の要約を付けたまま公開されていた。**

### 原因: プロンプトは番号を振っていたのに、スキーマが番号を返させていなかった

全コレクタのバッチ評価は `[0] [1] [2]…` と番号を振って渡している。ところが
`ArticleEvalSchema` / `HnEvalSchema` に `index` が無く、突き合わせは
`evaluations[i]` ↔ `candidates[i]` の**配列の位置**だけだった。番号は飾りでしかなかった。
**LLMが順序を保つという、一度も検証していない仮定**に全部が乗っていた。

該当は**7箇所**（RSS / ArXiv / HN / GitHub trending / HF models / HF papers / PwC）。
今日追加した2本だけの問題ではなく、**最初からこの形**だった。

### 件数チェックは、これを検出できない

各コレクタには `evaluations.length !== candidates.length` の警告が前からあった。
しかし**件数が合っていても中身は入れ替わる**。「n件返ってきたから正しい」は
件数しか見ていない＝[[pattern-wired-but-never-called]] と同じ型（機構はあるが見ている量が違う）。

**決定: `index` をスキーマの必須項目にし、`evalAt()` で番号で突き合わせる。**
本体は `src/lib/eval-align.ts`（テスト7件）。daily_pipeline から切り出したのは、
ここが**位置対応に黙って落ちる**箇所だからテストで押さえたかったため（feed-parse と同じ理由）。

- index が欠けていたら**位置対応にフォールバックする**。全件捨てるより、従来どおりの
  （ズレうる）対応で出す方がまだ良い（欠落より冗長）。
- ただし黙って落ちないよう、毎ラン `describeAlignment()` を出す
  （`[HF papers] 対応づけ: index で対応（6/6件）` / `index なし＝位置対応にフォールバック`）。

### 測定について自分の誤りを1つ

影響範囲を測ろうとして「タイトルの語が要約に1つも出てこない記事」を数えたら
直近24h 8.4% / 30〜60日前 1.3% と出た。**これは不具合の指標になっていない。**
今日足したコレクタのタイトルは `[GitHub] makecindy/cindy` `[モデル公開] Qwen/Qwen3.8-27B`
のような**英数字のスラッグ**で、日本語の要約と語を共有しないのが当たり前だから。
実際それらの要約を読むとどれも正しかった。**8.4%はタイトル形式の変化を測っただけ。**
確認できたのは目視した arxiv 3件で、**過去にどれだけあったかは分からない。**

### ⑩の後始末: ズレた6件を作り直した（本番DB更新済み）

**入れ替えでは直せなかった。**候補8件のうち2件がゲート（importance<5 / aiRelevance）で落ちており、
`Building Multilingual Bridges` の正しい要約は**保存されなかった行**に付いていたため。
だから再割り当てではなく、HF APIのabstractから6件まとめて作り直した
（`scripts/migrate_2026_09_13_fix_misaligned_summaries.ts`・`--dry` 可・接続先ホストを印字）。

このスクリプト自体が**直した経路の検証も兼ねている**: `対応づけ: index で対応（6/6件）` と出て、
6件すべて題と要約が一致した。

⚠ 副作用として、**元から正しかった2件も importance が振り直された**
（Memory as Plans ★9 → ★7）。同じ論文への別回のLLM判断であって誤りではないが、
★9を割ったことで朝刊の候補プール（★9以上）から外れる。作り直す範囲を絞れば避けられたが、
「全件が題と一致している」ことを優先した。

⚠ **直したのは今回ズレたと確認できた6件だけ。**過去の分は測れていないので触っていない。
分からないものを分かったことにして一括で作り直さない。
