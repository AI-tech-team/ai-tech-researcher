# AI Tech Researcher 🤖🔍

自走型AI技術情報収集・レポーティングシステムです。最新のAIモデル・ツール・研究動向を自動で収集し、エンジニアや研究者が効率よくキャッチアップできるレポートを日次生成します。

## 特徴
- **スマートシード進化**: キーワードのパフォーマンス（採用スコア）を自動で評価し、有用なキーワードを昇格・不要なものを降格
- **Gemini駆動のリサーチ**: Gemini 3.1 Flash Liteが各キーワードに関する最新技術情報を自律的に収集・要約
- **AIチャットコパイロット**: ダッシュボード内でGeminiに直接質問し、DBの情報を横断的に調査可能
- **プレミアムダッシュボード**: ガラスモーフィズムを採用したモダンなWebUIでレポートをリアルタイム閲覧
- **完全自動運用**: GitHub Actionsで毎日の情報収集・レポート生成・キーワード最適化を自動実行

## セットアップ

### 1. 依存関係のインストール
```bash
npm install
cd v2 && npm install && cd ..
```

### 2. 環境変数の設定
`v2/.env.local` を作成し、以下を設定してください：
```env
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-auth-token
GOOGLE_GENERATIVE_AI_API_KEY=your-gemini-api-key
```

### 3. シードデータの投入
```bash
cd v2 && npx tsx insert_300_seeds.ts
```

### 4. 開発サーバーの起動
```bash
cd v2 && npm run dev
```

## デプロイ（Vercel）

```bash
vercel --prod --cwd v2
```

## GitHub自動運用

GitHub Actions (`.github/workflows/run.yml`) が設定されています。
GitHubリポジトリの `Settings > Secrets and variables > Actions` に以下を登録することで、毎日自動でリサーチが実行されます：
- `GEMINI_API_KEY`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
