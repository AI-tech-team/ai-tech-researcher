# 外部スケジューラから GitHub Actions を起動する

## なぜこうしたか

GitHub Actions の `schedule` は大幅に遅れる。2026-09-12 に `pipeline_logs` の `duration_ms` から
起動時刻を逆算して実測した結果：

```
cron '7 18 * * *'（03:07 JST 起動のはず）の実際の起動時刻
  遅延 中央値 +167分 / 最小 +37分 / 最大 +482分
  → 実際の起動 05:54 JST、パイプライン45分、終了 06:31 JST
```

8月下旬は +37〜47分だったので悪化し続けている。「06:00にメールを届ける」という約束に対し、
03:07起動では 06:00 まで173分しか余裕が無く、遅延だけで食い潰されていた（＝メールが6:30着）。

**パイプラインを速くしても遅延は吸収できない。** 一方で `workflow_dispatch`（API経由の起動）は
`schedule` の待ち行列に入らないため遅れない。そこで：

| トリガ | 対象 | 理由 |
|---|---|---|
| 外部スケジューラ → `workflow_dispatch` | フル実行（03:07 JST）／レポート配信（06:00 JST） | 時刻の約束がある |
| GitHub `schedule` のまま | 収集6回・週次バックアップ | 締切が無いので遅れても害が無い |

外部スケジューラが止まっても収集は続き、12:17 の回にあるレポート自己修復が当日分を拾う。
ただし**週次／月次レポートはフル実行の中で生成される**ので、外部スケジューラが長期間止まると
生成されない。止まったことは購読者メールが来ないことで気づける。

---

## 1. GitHub の Personal Access Token を作る

`https://github.com/settings/personal-access-tokens/new`（**Fine-grained** を使う。classic ではない）

| 項目 | 値 |
|---|---|
| Token name | `cernoval-scheduler` |
| Expiration | 1年（期限切れで静かに止まるので、カレンダーに再発行を入れておく） |
| Repository access | **Only select repositories** → `AI-tech-team/ai-tech-researcher` |
| Permissions → Repository permissions → **Actions** | **Read and write** |

他の権限は全て `No access` のままにする。この1つだけで `workflow_dispatch` を叩ける。

生成された `github_pat_...` を控える（再表示できない）。

### 動作確認

```bash
curl -i -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <PAT>" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/AI-tech-team/ai-tech-researcher/actions/workflows/run.yml/dispatches \
  -d '{"ref":"main","inputs":{"report_type":"collect"}}'
```

`204 No Content` が返れば成功（本文は空）。Actions のページに実行が現れる。
`collect` で試すのは、失敗してもメールが飛ばないから。

---

## 2-A. Google Cloud Scheduler を使う場合（推奨）

既に GCP を使っている（Gemini API・予算キルスイッチが `project-6f8c0b7f`）。
ジョブ3つまで無料なので追加費用なし。アカウントも増えない。

```bash
gcloud config set project <プロジェクトID>
gcloud services enable cloudscheduler.googleapis.com

# ① フル実行（03:07 JST）
gcloud scheduler jobs create http cernoval-daily \
  --location=asia-northeast1 \
  --schedule="7 3 * * *" --time-zone="Asia/Tokyo" \
  --uri="https://api.github.com/repos/AI-tech-team/ai-tech-researcher/actions/workflows/run.yml/dispatches" \
  --http-method=POST \
  --headers="Accept=application/vnd.github+json,Authorization=Bearer <PAT>,X-GitHub-Api-Version=2022-11-28,Content-Type=application/json" \
  --message-body='{"ref":"main","inputs":{"report_type":"daily"}}'

# ② レポート生成＋配信（06:00 JST）
gcloud scheduler jobs create http cernoval-report \
  --location=asia-northeast1 \
  --schedule="0 6 * * *" --time-zone="Asia/Tokyo" \
  --uri="https://api.github.com/repos/AI-tech-team/ai-tech-researcher/actions/workflows/run.yml/dispatches" \
  --http-method=POST \
  --headers="Accept=application/vnd.github+json,Authorization=Bearer <PAT>,X-GitHub-Api-Version=2022-11-28,Content-Type=application/json" \
  --message-body='{"ref":"main","inputs":{"report_type":"report"}}'
```

即時テスト：`gcloud scheduler jobs run cernoval-report --location=asia-northeast1`

⚠ PAT がコマンド履歴に残る。作成後に `history -c`、または Secret Manager を使う。

## 2-B. cron-job.org を使う場合

GCP を触りたくない場合。無料・登録だけで使える。ジョブごとに以下を設定する。

| | フル実行 | レポート配信 |
|---|---|---|
| Title | cernoval-daily | cernoval-report |
| URL | `https://api.github.com/repos/AI-tech-team/ai-tech-researcher/actions/workflows/run.yml/dispatches` | 同左 |
| Schedule | 毎日 03:07（タイムゾーンを Asia/Tokyo に） | 毎日 06:00 |
| Method | POST | POST |
| Headers | `Accept: application/vnd.github+json`<br>`Authorization: Bearer <PAT>`<br>`X-GitHub-Api-Version: 2022-11-28`<br>`Content-Type: application/json` | 同左 |
| Body | `{"ref":"main","inputs":{"report_type":"daily"}}` | `{"ref":"main","inputs":{"report_type":"report"}}` |

「Treat 2xx as success」相当の設定があれば 204 を成功に含めること。

---

## 3. 効いたかどうかの測り方

数日動かしてから：

```bash
cd v2 && npx tsx scripts/_audit_delivery.ts   # 朝刊の生成完了時刻（06:00からの差）
cd v2 && npx tsx scripts/_audit_lag.ts        # フル実行の起動遅延
```

`_audit_delivery.ts` が **+1分** 前後で並べば成功。移行前は中央値 +32分だった。

## 4. 元に戻す

`run.yml` の `Run Daily Pipeline (full)` と `Generate & Send Daily Report` の `if:` に
`github.event.schedule == '<cron式>' ||` を戻し、`schedule:` に該当 cron を足す。
外部スケジューラ側のジョブは止めること（両方動くとパイプラインが二重に走り、Gemini課金も二重になる）。
