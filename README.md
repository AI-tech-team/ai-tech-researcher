# AI Tech Researcher 🤖🔍

Zennの記事「1年間の育休に備えて「勝手に賢くなる」AI情報収集基盤を作った」をベースにした、自走型AI技術情報収集システムです。

## 特徴
- **Skillベースの実行**: Markdown形式の手順書を読み込み、LLM（Gemini）が自律的にタスクを遂行。
- **情報ソースの自己進化**: レポートへの採用実績に基づき、キーワードのスコアリングと昇格・降格を自動で実施。
- **プレミアム・ダッシュボード**: ガラスモーフィズムを採用した洗練されたWeb UIでレポートを閲覧可能。
- **GitHub Actionsによる自動運用**: 毎日決まった時間に自動でリサーチを実行。

## セットアップ

### 1. 依存関係のインストール
```bash
npm install
cd web && npm install && cd ..
```

### 2. 環境変数の設定
`.env.example` を `.env` にコピーし、APIキーを設定してください。
- `GEMINI_API_KEY`: Google AI Studioから取得してください。

### 3. 実行
**日次パイプラインの実行（収集・レポート・進化）:**
```bash
npx tsx scripts/run_daily.ts
```

**Webダッシュボードの起動:**
```bash
# Backend (API Server)
npx tsx src/server.ts

# Frontend (Dashboard)
cd web && npm run dev
```

## GitHub自動運用
GitHub Actions (`.github/workflows/run.yml`) が設定されています。
GitHubレポジトリの `Settings > Secrets and variables > Actions` に `GEMINI_API_KEY` を登録することで、毎日自動でリサーチが実行されます。
