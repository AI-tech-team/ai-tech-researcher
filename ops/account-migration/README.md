# 個人垢 → 業務垢 インフラ移行 runbook

公開プロダクトのインフラを個人アカウントから業務アカウントへ移す手順書。
**各段は独立・低リスク順。1段ずつ本番確認してから次へ。** 焦らない。今のまま公開継続でOK。

- [あなた] = コンソール操作（本人認証が要るので本人がやる）
- [私] = コード/env/スクリプト/キルスイッチ/この手順書

## 現状と移行先

| コンポーネント | 現在 | 移行先 | 状態 |
|---|---|---|---|
| GitHub repo (`meguru-v1/ai-tech-researcher`) | 個人 | 業務 **Organization** | 未 |
| GitHub Actions（毎日cron） | repo付随 | repo移行に追随 | 未 |
| Vercel ホスティング | 個人 | 業務 **Team** | 未 |
| Turso DB（dev/prod 2本） | 個人 | 業務 **organization** | 未 |
| Gemini APIキー・課金・予算キルスイッチ | 個人 `project-6f8c0b7f` | 業務Google下の**新GCP project** | 未 |
| OAuth（Googleログイン） | 個人 同project | 同・新project | 未 |
| Googleフォーム / メール送信元 | — | **業務（移行済）** | ✅ |

業務用Googleは **普通のGoogleアカウント（非Workspace・独自ドメイン無し）**。
→ GCPの「組織」化(Cloud Identity)は無し。OAuth/Geminiは業務アカウント下の**新プロジェクト**に置く（org無し）。ブランドを整えたくなったら独自ドメイン取得が別オプション。

## 大原則（事故防止）
1. **env取りこぼし＝本番断**。下の棚卸し表を必ず突き合わせる。特に **`AUTH_SECRET` はコードに出てこない暗黙env**＝忘れると全ユーザーのログインが死ぬ。
2. **ロールバック前提**：旧リソース（DB/プロジェクト/OAuthクライアント）は切替が安定するまで**消さない**。ダメなら戻す。
3. **DBとOAuthはメンテ枠**で（毎朝06:00 JSTにcronがDBへ書く＝その時間を避ける）。

---

## env 棚卸し（全部・取りこぼし防止）

| 変数 | 用途 | 保存場所 | 移行で値が変わる |
|---|---|---|---|
| `TURSO_DATABASE_URL` | DB接続 | Vercel＋GitHub Actions | ✅ Step3 |
| `TURSO_AUTH_TOKEN` | DB認証 | Vercel＋GitHub Actions | ✅ Step3 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini | Vercel＋GitHub Actions | ✅ Step4a |
| `GOOGLE_CLIENT_ID` | OAuth | Vercel | ✅ Step4b |
| `GOOGLE_CLIENT_SECRET` | OAuth | Vercel | ✅ Step4b |
| `AUTH_SECRET` ⚠️**暗黙・コードに無い** | JWT署名(next-auth) | Vercel | ❌ **そのまま引継**（忘れるとログイン全死） |
| `GMAIL_USER` | メール送信 | Vercel＋GitHub Actions | ❌ 既に業務 |
| `GMAIL_APP_PASSWORD` | メール送信 | Vercel＋GitHub Actions | ❌ 既に業務 |
| `REPORT_TO` | 通知先 | Vercel＋GitHub Actions | ❌ |
| `OWNER_EMAIL` | オーナー判定(isOwner) | Vercel | ❌（業務の自分のメールに合わせる場合は更新） |
| `CRON_SECRET` | /api/report 保護 | Vercel | ❌ |
| `NEXT_PUBLIC_SITE_URL` | サイトURL/OG/メールリンク | Vercel（CIは未設定→既定値） | △ 独自ドメイン時のみ |
| `NEXT_PUBLIC_CONTACT_EMAIL` | 問合せ表示 | Vercel | ❌ |
| `NEXT_PUBLIC_FEEDBACK_FORM_ACTION` | フォーム送信先 | Vercel | ❌ 既に業務フォーム |
| `NEXT_PUBLIC_FEEDBACK_ENTRY` | フォームentry | Vercel | ❌ |
| `NEXT_PUBLIC_FEEDBACK_ENTRY_EMAIL` | フォームentry(メール) | Vercel | ❌ |
| （任意）`BATCH_MAX` `BATCH_CHUNK` `PIPELINE_MODE` `SKIP_DAILY_REPORT_EMAIL` | パイプライン調整 | GitHub Actions | ❌ |

> **GitHub Actions が使う secret**（`.github/workflows/run.yml`）= `TURSO_DATABASE_URL` `TURSO_AUTH_TOKEN` `GOOGLE_GENERATIVE_AI_API_KEY` `GMAIL_USER` `GMAIL_APP_PASSWORD` `REPORT_TO`。
> **Vercel が使う env** = 上表の Vercel 行すべて（アプリ実行時＋ビルド時の `NEXT_PUBLIC_*`）。

---

## Step 1: GitHub（★易・ほぼ無停止）

1. [あなた] 業務アカウントで **Organization を作成**（Free でOK）。
2. [あなた] repo Settings → **Transfer ownership** → 新Orgへ。
   - Issue/PR/Star/履歴/Actions定義はそのまま移る。旧URLは新URLへ自動リダイレクト。
3. [あなた] 新Orgの repo に **Actions secrets を再投入**（上の「GitHub Actions が使う secret」6個）。Transfer では secret は移らない。
4. [あなた] Settings → Actions → **Workflow permissions = Read and write**（週次バックアップが `git push` するため）。
5. [あなた] ローカルの remote を更新：`git remote set-url origin <新URL>`。
6. **検証**：Actions を `workflow_dispatch`（report_type=collect）で手動実行 → 緑になればOK。
7. [私] Vercel の Git 連携が新repoを指すよう確認（Step2と一緒に）。

※ Vercel は GitHub と連携しているので、repo を Org に移したら **Vercel 側の Git 連携を貼り直す**必要が出る（Step2で対応）。

---

## Step 2: Vercel（★★中・ほぼ無停止）

1. [あなた] 業務アカウントで **Team を作成**（Hobbyチーム or Pro）。
2. [あなた] 既存プロジェクトを Team へ **Transfer**（Project Settings → Advanced → Transfer）。または新規 Import。
   - **Root Directory = `v2`** を維持。Framework=Next.js。
3. [あなた] **Environment Variables を全部移植**（上表の Vercel 行＝Production/Preview両方）。
   - ⚠️ `AUTH_SECRET` を**必ず**含める（コードに出ないので忘れやすい）。
4. [あなた] Git 連携を新Orgの repo に接続（Step1で移したもの）。
5. [あなた] ドメイン：今は `*.vercel.app`。独自ドメインを使うならここで追加（任意・後でも可）。
6. [あなた] **Web Analytics** を新プロジェクトで有効化。
7. **検証**：main へ空コミット or 再デプロイ → トップ/記事/レポート/ログインが出るか。**この時点では OAuth/Gemini/Turso は旧（個人）のまま**なので、まだ普通に動くはず。

---

## Step 3: Turso（★★中・メンテ枠を取る）

> 毎朝06:00 JST に cron が prod DB へ書く。**朝以外**の時間に実施。

1. [あなた] 業務アカウントで Turso **organization を作成**。
2. [あなた] 新org に **dev と prod の空DBを2本作成**（リージョンは現行と同じに）。
3. [あなた] 一時的に **GitHub Actions cron を止める**（workflowを無効化 or schedule一時コメントアウト）＝移行中の書込衝突を防ぐ。
4. [あなた/私] **データ移行**（Turso CLI / SQLite dump→restore）。FTS5・ベクトル表ごと移る dump 方式を使う：
   ```bash
   # 旧(個人)prod を dump
   turso db shell <旧prod名> .dump > prod_dump.sql
   # 新(業務)prod へ流し込み
   turso db shell <新prod名> < prod_dump.sql
   # dev も同様
   ```
   （既存 `v2/scripts/backup.ts` の出力も補助に使える。）
5. [あなた] **env 差替**：`TURSO_DATABASE_URL` `TURSO_AUTH_TOKEN` を Vercel と GitHub Actions の両方で新DBへ。
6. [あなた] cron を再開。
7. **検証**：新DBに向けた本番でトップ表示・記事数が一致するか。`workflow_dispatch`(collect) で書込も通るか。
8. [私] 移行後に件数照合スクリプトを用意（旧↔新で records 数チェック）。

---

## Step 4: Google側（★★★・最後・OAuth＋Gemini を一括で）

> ここが本丸。OAuth と Gemini は同じ個人プロジェクトに同居しているので、**新GCPプロジェクトを1つ作ってまとめて移す**。

### 4a. Gemini API（課金＋キー＋キルスイッチ）
1. [あなた] 業務Googleで **新GCPプロジェクト**作成 → **Generative Language API を有効化**。
2. [あなた] 課金アカウントを紐付け（業務の支払い手段）。
3. [あなた] **新APIキー**発行 → キーに **API制限**（Generative Language API のみ）。
4. [あなた] env 差替：`GOOGLE_GENERATIVE_AI_API_KEY` を Vercel＋GitHub Actions で新キーへ。
5. [あなた/私] **予算キルスイッチを新プロジェクトで再構築** → `../gcp-billing-killswitch/README.md` の手順をそのまま新project/新課金アカウントに対して実行（`run.invoker` 付与の罠も同README参照）。
6. [あなた] 旧プロジェクトの Gemini 利用が止まったのを確認してから、旧キー無効化＋旧キルスイッチ撤去。

### 4b. OAuth（Googleログイン）
1. [あなた] 新GCPプロジェクトで **OAuth 同意画面**を構成（External / アプリ名 / サポートメール＝業務）。
2. [あなた] **OAuth クライアント(Web)** を作成 → **承認済みリダイレクトURI**に本番＋プレビューを登録：
   - `https://<本番ドメイン>/api/auth/callback/google`
   - （独自ドメインを使うならそのドメインでも）
3. [あなた] env 差替：`GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` を Vercel で新クライアントへ。`AUTH_SECRET` は据え置き（変えると既存ログインセッションが無効化されるだけで実害は小、変えなくてよい）。
4. **断ゼロのコツ**：旧クライアントを消さず、新クライアントのenvに差替→ログイン検証→OKを確認してから旧を削除。
5. **検証**：シークレットウィンドウでログイン→アカウント選択→`users` に入る→お気に入り等が動く。

### 4c. 後片付け
- 旧個人プロジェクトの課金・キー・OAuthクライアント・キルスイッチを撤去（全部新側で動作確認後）。

---

## 各段の検証チェックリスト（最低限）
- [ ] トップが表示される（記事フィード）
- [ ] 記事/レポートの個別ページが開く
- [ ] **Googleログイン**できる（アカウント選択→`users`登録）
- [ ] お気に入り/後で読む/既読が保存される
- [ ] `workflow_dispatch`(collect) でパイプラインが緑（DB書込＋Gemini）
- [ ] 日次レポートのメールが届く（翌朝 or 手動daily実行）
- [ ] **予算キルスイッチ**がテスト発行で「しきい値未満」ログを返す（新project）

## ロールバック
各 env は旧値を控えておき、問題が出たら **Vercel/GitHub Actions の該当 env を旧値へ戻す**だけで即復旧（旧リソースを消していないことが前提）。DBは旧DBがそのまま残っているので URL/TOKEN を戻せば旧DBに戻る。
