# 個人垢 → Proton名義垢 インフラ移行 runbook

公開プロダクトのインフラを、個人アカウントから **`hayasi.hajime@proton.me` 名義**へ集約する手順書。
**各段は独立・低リスク順。1段ずつ本番確認してから次へ。** 焦らない。今のまま公開継続でOK。

- [あなた] = コンソール操作（本人認証が要るので本人がやる）
- [私] = コード/env/スクリプト/キルスイッチ/この手順書

> **経緯（重要）**: 2026-06 に「業務用Google」へ移す前提で Step1(GitHub org)・Step2(Vercel再接続)・Step3(Turso `-2` DB) を実施済み。
> **2026-08-11 に方針変更**＝移行先は業務用Googleではなく **Proton名義に統一**。よって GitHub/Vercel/Turso は **もう一度**、今度は Proton 名義側へ寄せる。
> 6月版の手順（業務Google前提）は git 履歴を参照。

## 現状（2026-08-12 実測）

| コンポーネント | 現在 | 移行先 | 状態 |
|---|---|---|---|
| GitHub repo | `AI-tech-team/ai-tech-researcher`（org owner=`meguru-v1`） | **アカウントは作らず `meguru-v1` のメールをProtonへ変更** | ✅ 2026-08-12 |
| GitHub Actions（毎日cron） | 同repo・secret 9個 | repoごと不動（メール変更のみ） | ✅ 影響なし確認 |
| Vercel | 旧個人垢のまま（CLIから不可視・`vercel whoami`=Not authorized） | **Team `hayasi-hajime` へ Transfer**（Team自体は既存・`planetarium`が同居） | 未 |
| Turso DB | 旧個人垢 org（prod=`ai-researcher-prod-2` / dev=旧dev） | Proton新垢の org へ再移行 | 未 |
| Gemini APIキー・課金・予算キルスイッチ | 個人 `project-6f8c0b7f` | Proton名義Google下の新GCP project | 未（Step0待ち） |
| OAuth（Googleログイン） | 個人 同project | 同・新project | 未（Step0待ち） |
| Googleフォーム / メール送信元 | 業務用Google | Proton名義Googleへ寄せ直す | 未（Step0待ち） |

### 制約（設計を縛る・確認済み）
- **Protonアドレスは自動メール送信に使えない**。SMTP submissionトークンは Proton Business 限定、Bridge は常駐アプリ必須で GitHub Actions/Vercel から叩けない。
  → 毎朝の配信は **Gmail SMTP 継続**（差出人＝Step0で用意するGoogleアドレス）。独自ドメイン＋Resend は別ルート・今回スコープ外。
- **`v2/src/auth.ts:23` は users を email で upsert（`sub` 非依存）** → OAuthクライアントを差し替えても既存ユーザーは壊れない。

## 大原則（事故防止）
1. **env取りこぼし＝本番断**。下の棚卸し表を必ず突き合わせる。特に **`AUTH_SECRET` はコードに出てこない暗黙env**＝忘れると全ユーザーのログインが死ぬ（ローカル `v2/.env.local` に控えあり）。
2. **ロールバック前提**：旧リソース（DB/プロジェクト/OAuthクライアント）は切替が安定するまで**消さない**。ダメなら戻す。
3. **DBとOAuthはメンテ枠**で（毎朝06:00 JSTにcronがDBへ書く＝その時間を避ける）。
4. **本番secretは人手の貼付でなくファイルから設定**（`_set_gh_secrets.ts`）。6月の `prod-2`/`dev-2` 取り違え事故の再発防止。

---

## env 棚卸し（2026-08-12 実測で是正済み）

| 変数 | 用途 | 保存場所 | 移行で値が変わる |
|---|---|---|---|
| `TURSO_DATABASE_URL` | DB接続 | Vercel＋GH Actions | ✅ Step3 |
| `TURSO_AUTH_TOKEN` | DB認証 | Vercel＋GH Actions | ✅ Step3 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini（**Vercel側でも使う**: `retrieval.ts`/`daily-report.ts`/`actions.ts`） | Vercel＋GH Actions | ✅ Step4a |
| `GOOGLE_CLIENT_ID` | OAuth | Vercel | ✅ Step4b |
| `GOOGLE_CLIENT_SECRET` | OAuth | Vercel | ✅ Step4b |
| `AUTH_SECRET` ⚠️**暗黙・コードに無い** | JWT署名(next-auth) | Vercel | ❌ **そのまま引継**（忘れるとログイン全死） |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | メール送信・エラー通知 | Vercel＋GH Actions | ✅ Step4c（Proton不可のためGmail継続・アドレスのみ変更） |
| `REPORT_TO` | 通知先 | Vercel＋GH Actions | △ 新アドレスにするなら |
| `OWNER_EMAIL` | オーナー判定(`lib/owner.ts`) | Vercel | △ **カンマ区切りで旧＋新を併記→安定後に旧削除**＝断ゼロ |
| `NEXT_PUBLIC_SITE_URL` | サイトURL/OG/メールリンク | Vercel | ❌（独自ドメイン時のみ） |
| `NEXT_PUBLIC_CONTACT_EMAIL` | 問合せ表示 | Vercel | △ 表示アドレスを変えるなら |
| `NEXT_PUBLIC_FEEDBACK_FORM_ACTION` / `_ENTRY` / `_ENTRY_EMAIL` | Googleフォーム | Vercel | ✅ Step4d（フォームを作り直す場合） |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push購読(`PushToggle.tsx`) | Vercel | ❌ |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push送信(pipeline) | GH Actions | ❌ |
| （任意）`BATCH_MAX` `BATCH_CHUNK` `PIPELINE_MODE` `DEEP_LIMIT` `CHUNK_LIMIT` `BACKFILL_MAX` | パイプライン調整 | GH Actions | ❌ |

**GitHub Actions の secret 実測（9個）**: `TURSO_DATABASE_URL` `TURSO_AUTH_TOKEN` `GOOGLE_GENERATIVE_AI_API_KEY` `GMAIL_USER` `GMAIL_APP_PASSWORD` `REPORT_TO` `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `VERCEL_URL`。Actions variables は **0個**。

**表と実装のズレ（今回の実測で判明・移行とは別件）**
- `CRON_SECRET` は **廃止済み**（`v2/docs/decisions.md:195`「/api/reportのCRON_SECRET経路は不要になり削除」）→ 表から削除した。
- `VERCEL_URL` secret は **どのworkflowからも参照されていない**（残骸）。移行のついでに削除してよい。
- `run.yml:82-83` が参照する `VAPID_SUBJECT` / `SITE_URL` は **secret 未設定**。コード上は任意（未設定なら既定値）なので現状は無害。

---

## Step 0: Google アカウント（Proton名義）★最初にやる・他の設計を決める

1. [あなた] **`hayasi.hajime@proton.me` をログインIDにしたGoogleアカウントを作れるか実試行**。
   - 作れた → Gemini/OAuth/送信メール/フォームをこの1垢に集約。
   - 弾かれた → **新Gmailを作成し、復旧用メールをProtonに設定**。この場合 `GMAIL_USER` は新Gmailになる。
2. [あなた] 2段階認証を設定（復旧先＝Proton）。
3. **この結果でStep4の設計が決まる**ので、判明したらこのrunbookに追記する。

> Step1〜3は Step0 の結果に依存しない。**Step0が未了でも先に進めてよい**（Proton側のメールアドレスさえあれば足りる）。

---

## Step 1: GitHub＝新アカウントを作らず `meguru-v1` のメールをProtonへ変更（★易・無停止）✅ 2026-08-12 完了

> **完了時の実測**: primary=`hayasi.hajime@proton.me`(verified/private)、`222714034+meguru-v1@users.noreply...` 残存、旧Gmail 2件削除済、`id=222714034` 不変、Actions active・直近5回success。
> **ハマり**: 「Primary email address のドロップダウンが出ない」＝ UIの問題ではなく **verify 未完了**（`gh api user/emails` で `verified=false` を実測して確定）。GitHubは **verified な実アドレスが2つ以上ないと primary を切り替えられない**（noreplyは候補に出ない）。画面を読み合う前に `gh api user/emails` で測るのが速い（`user` スコープが要る＝`gh auth refresh -h github.com -s user`）。

> **新アカウントを作らない理由**: 身元スクラブで公開694コミットを `222714034+meguru-v1@users.noreply.github.com` に書き換え済み。新垢だと数値ID(222714034)が変わり、**全履歴の帰属が旧垢に取り残される**。メール変更なら org/secrets/URL/履歴すべて無傷。

1. [あなた] GitHub → Settings → **Emails** → `Add email address` に `hayasi.hajime@proton.me` → Protonに届く確認メールで verify。
2. [あなた] 同ページで **Primary email address を Proton に切替**。
3. [あなた] **`Keep my email addresses private` は ON のまま維持**（noreply アドレスが変わらない＝履歴の帰属が保たれる）。
4. [あなた] **`Block command line pushes that expose my email` も ON 推奨**（本名メールでのpush事故防止）。
5. [あなた] 旧個人Gmailを **Remove**（3を維持していれば公開リポの履歴は無傷。非公開化した他リポに旧メール commit が残っていれば、その帰属アイコンが消えるだけ）。
6. [あなた] Settings → **Password and authentication** → 2FA の復旧設定・バックアップコードを新メール前提に更新。
7. **検証**: `gh api user --jq .login` が `meguru-v1` のまま／Actions の "Research Pipeline" が引き続き active ／`workflow_dispatch`(collect) が緑。

- 影響なし（確認済み）: org `AI-tech-team` の所有、repo URL、Actions secret 9個、ローカル remote、過去コミットの帰属。
- ローカル git は既に匿名化済み（[[privacy-identity-scrub]]）＝`user.email` の変更は不要。

---

## Step 2: Vercel＝再importせず Team `hayasi-hajime` へ Transfer（★★中・数分のデプロイ停止）

> **再importしない理由**: env（`AUTH_SECRET` 含む）・`vercel.json` の hnd1 固定・`ai-tech-researcher.vercel.app` を維持できる。作り直すと全部貼り直し＝取りこぼしリスク。

1. [あなた] **移管前に env を控える**（保険）。旧個人垢でブラウザから Project Settings → Environment Variables を全部コピー、または旧垢で `vercel login` → `vercel env pull .env.backup`（このファイルは **絶対にコミットしない**）。
2. [あなた] Team `hayasi-hajime` に**旧個人垢のメールを Owner として招待** → 旧個人垢で承認（Transfer先は「自分が属するTeam」しか選べないため）。
3. [あなた] 旧個人垢で project `ai-tech-researcher` → **Settings → Advanced → Transfer Project** → `hayasi-hajime` を選択。
   - Root Directory=`v2` / Framework=Next.js / Production Branch=main は維持される。
4. [あなた] 移管後、**Team側に Vercel GitHub App を入れ直す**（org `AI-tech-team` へのアクセスを許可）。Git連携が切れていたら `AI-tech-team/ai-tech-researcher` に再接続。
5. [あなた] **env の実在チェック**：上の棚卸し表の Vercel 行が Production/Preview 両方に揃っているか（特に `AUTH_SECRET`）。欠けていたら1のバックアップから補充。
6. [あなた] Web Analytics / Speed Insights が有効のままか確認。
7. [あなた] 安定後、Team メンバーから**旧個人垢を削除**。
8. **検証**: 空コミットpush → 自動デプロイ緑 → トップ/記事/レポートが開く → **シークレットウィンドウでGoogleログイン**（この時点ではOAuth/Gemini/Turso は旧のままなので普通に通るはず）→ お気に入り保存。
9. [私] 移管後に `vercel whoami --scope hayasi-hajime` と `vercel project ls` でCLIから可視になったことを確認（以後CLIで env 差替が可能になる＝Step3/4が楽になる）。

⚠️ `ai-tech-researcher.vercel.app` は Team に同名プロジェクトが無ければ維持される。`planetarium` と名前衝突しないので問題なし。

---

## Step 3: Turso＝Proton新垢に org を作り DB を再移行（★★中・メンテ枠を取る）

> 毎朝06:00 JST に cron が prod DB へ書く。**朝以外**の時間に実施。6月の移行実績（精度100%・ドリフト0）と同じ手順を再演する。

1. [あなた] Proton アドレスで **Turso 新アカウント → organization 作成**。
2. [あなた] 新org に **prod と dev の空DBを2本作成**（リージョンは現行と同じ）。
   - **命名は旧と明確に区別する**（例: `airesearcher-prod-p` / `-dev-p`）。6月は `prod-2`/`dev-2` が似ていて GitHub secret を dev に向けてしまう事故が起きた。
3. [私] `v2/.env.migrate`（gitignore）に新DBの `DST_URL` / `DST_TOKEN`、旧prodの `SRC_URL` / `SRC_TOKEN` を書く。
4. [私] `gh workflow disable` で **cron停止**（書込衝突防止）。
5. [私] **dev で予行** → `_migrate_check.ts`（プリフライト）→ `_migrate_db.ts`（RESET=1）→ `_migrate_verify.ts`（中身バイト照合）。
6. [私] **本番移行** `SRC_PROD=1 _migrate_db.ts` → `_migrate_verify.ts` で全テーブル件数一致＋FTS＋ベクトル索引＋バイト照合。
7. [私] **ドリフト0確認**（停止中に旧へ書込が無かったか）→ env差替：
   - GitHub Actions＝`_set_gh_secrets.ts`（`.env.migrate` から直接設定。人手の貼付をしない）
   - Vercel＝Step2完了後ならCLIで差替可能。`_which_db.ts` で書込先を確認。
8. [私] cron再開（`gh workflow enable`）。
9. **検証**: トップの記事数が一致／`/api/health` が緑／`workflow_dispatch`(collect) で書込が通る／翌朝06:00のレポート生成。
10. 旧DB（`ai-researcher-prod-2` と旧dev）は**凍結してロールバック用に残す**。

**既知のハマり（6月の実績）**: ①ローカル`file:`libsqlは この環境で動かない→リハーサルも実Tursoへ ②FK制約→依存順(topoSort)で投入 ③重いベクトル索引の一括構築が502→**空表へ索引を先に作り増分構築**＋全DDLリトライ ④FTS shadow残でRESET空チェック誤判定→多段DROP ⑤**似た名前のDB取り違え**（上記2の命名ルールで防ぐ）。

---

## Step 4: Google側（★★★・最後・Step0の結果が前提）

> OAuth と Gemini は同じ個人プロジェクトに同居。**新GCPプロジェクトを1つ作ってまとめて移す**。

### 4a. Gemini API（課金＋キー＋キルスイッチ）
1. [あなた] Step0のGoogle垢で**新GCPプロジェクト**作成 → **Generative Language API** を有効化。
2. [あなた] 課金アカウントを紐付け。
3. [あなた] **新APIキー**発行 → キーに **API制限**（Generative Language API のみ）。
4. [私] env差替：`GOOGLE_GENERATIVE_AI_API_KEY` を Vercel＋GH Actions で新キーへ。
5. [あなた/私] **予算キルスイッチを新プロジェクトで再構築** → `../gcp-billing-killswitch/README.md` の手順を新project/新課金アカウントに実行（`run.invoker` 付与の罠も同README）。**再構築が済むまで旧キルスイッチを外さない**（¥2000上限の保険を切らさない）。
6. [あなた] 旧プロジェクトのGemini利用が0になったのを確認してから、旧キー無効化＋旧キルスイッチ撤去。

### 4b. OAuth（Googleログイン）
1. [あなた] 新GCPプロジェクトで **OAuth同意画面**（External / アプリ名 / サポートメール）。**同意画面に本名が出ないか確認**（[[privacy-identity-scrub]]）。
2. [あなた] **OAuthクライアント(Web)** 作成 → 承認済みリダイレクトURIに `https://ai-tech-researcher.vercel.app/api/auth/callback/google`（＋使うならプレビュー/独自ドメイン）。
3. [私] env差替：`GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` を Vercel で新クライアントへ。**`AUTH_SECRET` は据え置き**。
4. **断ゼロのコツ**: 旧クライアントを消さず、env差替→ログイン検証→OK後に旧を削除。
5. **検証**: シークレットウィンドウでログイン → `users` に入る（email upsert なので既存ユーザーは同一行に紐付く）→ お気に入り/後で読むが引き継がれている。

### 4c. メール送信
1. [あなた] Step0のGoogleアドレスで**アプリパスワード**発行（2段階認証が前提）。
2. [私] `GMAIL_USER` / `GMAIL_APP_PASSWORD` を Vercel＋GH Actions で差替。`REPORT_TO` も新アドレスへ。
3. **検証**: `workflow_dispatch`(daily) でレポートメールが届く／`logError` のエラー通知が届く。

### 4d. Googleフォーム（フィードバック）
1. [あなた] 新垢でフォームを作り直す or 既存フォームのオーナー権限を新垢へ移譲。
2. [私] `NEXT_PUBLIC_FEEDBACK_FORM_ACTION` / `_ENTRY` / `_ENTRY_EMAIL` を差替。
3. **検証**: 公開UIからフィードバック送信 → 新垢の回答に入る。

### 4e. 後片付け
- `OWNER_EMAIL` から旧アドレスを削除（安定後）。
- 旧個人GCPプロジェクトの課金・キー・OAuthクライアント・キルスイッチを撤去。
- 旧Turso DB を削除（ロールバック不要と確信してから）。

---

## 各段の検証チェックリスト（最低限）
- [ ] トップが表示される（記事フィード）
- [ ] 記事/レポートの個別ページが開く
- [ ] **Googleログイン**できる（アカウント選択→`users`登録）
- [ ] お気に入り/後で読む/既読が保存される
- [ ] 検索が返る（FTS＋ベクトル索引が移行できている証拠）
- [ ] `/api/health` が緑
- [ ] `workflow_dispatch`(collect) でパイプラインが緑（DB書込＋Gemini）
- [ ] 日次レポートのメールが届く（翌朝 or 手動daily実行）
- [ ] **予算キルスイッチ**がテスト発行で「しきい値未満」ログを返す（新project）

## ロールバック
各 env は旧値を控えておき、問題が出たら **Vercel/GitHub Actions の該当 env を旧値へ戻す**だけで即復旧（旧リソースを消していないことが前提）。DBは旧DBが残っているので URL/TOKEN を戻せば旧DBに戻る。Vercel の Transfer も逆向きに実行できる。
