

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
