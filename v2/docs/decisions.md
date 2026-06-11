

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
