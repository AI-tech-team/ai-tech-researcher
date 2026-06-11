# GCP 予算キルスイッチ（請求を自動停止）

予算アラート(Pub/Sub) → Cloud Function が **しきい値超過でプロジェクトの請求を無効化**する。
Gemini のコストを「金額で完全に止める」唯一の仕組み（Google には $X で止める標準ボタンが無いため）。

> ⚠️ 発動するとプロジェクト全体の請求がOFF＝**Gemini が止まり日次パイプラインも失敗**する。復旧は手動。
> 予算データは**数時間ラグ**があるので瞬間の暴走止めにはならない。瞬時の歯止めは別途 **APIクォータ**（RPM/RPD を低めに）を併用すること。

---

## 実行場所
**Google Cloud Shell**（ https://console.cloud.google.com → 右上の `>_` アイコン）で実行するのが楽（gcloud 同梱・bash）。
このフォルダの `index.js` と `package.json` を Cloud Shell 上に作る（エディタに貼る or `git clone`）。

## 0. 変数（自分の値に置換）
```bash
export PROJECT_ID="あなたのプロジェクトID"          # Gemini APIキーが属すプロジェクト
export REGION="asia-northeast1"                     # 東京
export BILLING_ACCOUNT_ID="XXXXXX-XXXXXX-XXXXXX"    # お支払い→アカウント管理 で確認
gcloud config set project "$PROJECT_ID"
```

## 1. 必要APIを有効化
```bash
gcloud services enable \
  cloudbilling.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com \
  artifactregistry.googleapis.com
```

## 2. Pub/Sub トピック作成
```bash
gcloud pubsub topics create billing-stop
```

## 3. 関数をデプロイ（index.js / package.json のあるフォルダで）
```bash
gcloud functions deploy stopBilling \
  --gen2 --runtime=nodejs20 --region="$REGION" \
  --source=. --entry-point=stopBilling \
  --trigger-topic=billing-stop \
  --max-instances=1
```

## 3.5 トリガSAに run.invoker を付与（⚠️必須・自動では付かない）
gen2はCloud Run上で動き、Eventarc(Pub/Sub)トリガが関数を呼ぶ実行SAに `run.invoker` が要る。
**これが無いと配信が403で弾かれ続け、関数は一切起動しない**（今回ここで詰まった）。
```bash
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud run services add-iam-policy-binding stopbilling --region="$REGION" \
  --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/run.invoker"
```

## 4. 関数の実行SAに「請求を無効化する権限」を付与
gen2 の既定実行SA = `PROJECT_NUMBER-compute@developer.gserviceaccount.com`
```bash
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
export SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
gcloud billing accounts add-iam-policy-binding "$BILLING_ACCOUNT_ID" \
  --member="serviceAccount:$SA" \
  --role="roles/billing.admin"
```

## 5. 予算をこのトピックに接続
コンソール: **お支払い → 予算とアラート → 対象の予算 → 編集 →
「通知を管理(Manage notifications)」→「このトピックに Pub/Sub を接続」にチェック → `billing-stop` を選択 → 保存**。
（前回作った ¥3,000 の予算にそのまま接続すればOK。100% しきい値超過で発火する。）

## 6. テスト（安全：止めない経路だけ確認）
cost ≤ budget の偽メッセージを流して「何もしない」ログが出るか確認する。
```bash
gcloud pubsub topics publish billing-stop \
  --message='{"costAmount":1,"budgetAmount":3000,"budgetDisplayName":"test"}'
gcloud functions logs read stopBilling --region="$REGION" --gen2 --limit=10
```
→ ログに「しきい値未満。何もしない。」が出れば配線OK。
（cost > budget で流すと**本当に請求が止まる**ので、復旧手順を理解した上でだけ試す。）

## 復旧（請求が止まった後に再開する）
コンソール: **お支払い → （対象プロジェクト）→「請求先アカウントをリンク」**で元のアカウントを再リンク。
その後 Gemini / パイプラインが復活する。

---

## 補足
- この仕組みは **方法2（金額キャップ）**。瞬間の暴走は止めきれない（ラグ）ので、
  **APIクォータ（Generative Language API の RPM/RPD を低め）** を併用するのが堅い。
- 関数・Pub/Sub・Eventarc 自体の費用はほぼ無料枠内（月数円〜0）。

---

## ✅ 実構築済み（2026-06-11・本番デプロイ済）
- 対象project: `project-6f8c0b7f-7452-4e63-a48`（billing有効＋Gemini有効＝課金が発生する唯一のプロジェクト）
- 請求アカウント: `01C5C2-5F27D4-A06CE3`
- トピック: `billing-stop` ／ 関数: `stopBilling`(gen2/asia-northeast1/実行SA=127993701737-compute@…)
- 予算: 「Geminiキルスイッチ」**¥2,000/月**・このproject限定・しきい値50/90/100%・topic接続済
- 付与済IAM: 実行SAに `billing.admin`(billing acct) と `run.invoker`(Run service)
- 動作確認: テスト発行→「受信…しきい値未満。何もしない。」を確認。実予算からの通知(当月実支出≈¥85〜92)も受信＝結線が生きている。
- 既存の別予算「予算」¥300（全project対象・topic未接続・アラート専用）はそのまま温存。
- 補足: 当月実支出が¥90前後＝¥2,000に対し約1/20。通常運用では発火せず、暴走時のみ請求停止。
