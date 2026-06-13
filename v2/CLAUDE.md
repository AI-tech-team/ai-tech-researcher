@AGENTS.md

# ⚠️ コード着手前チェック（VibeCoding 6原則）

出典: 20年エンジニアの警告 https://qiita.com/Akira-Isegawa/items/00f23d206c504db2ac3b
**機能を書く前に必ずこの6点を自問する。特に第三条(法務)は「後から直す」が効かないので着手前に問う。**
「知らなかった」は法律の前で言い訳にならない（著作権侵害は親告罪だが刑事罰あり）。

## 第一条 セキュリティ（最優先・一線）
- Secrets/APIキー/トークンは**コード直書き禁止→env**（`.env*`は`.gitignore`済）。
- **IDOR**: 全データアクセスはサーバ側でセッション`userId`にスコープ（クライアント供給のidを信用しない）。書込Action/APIは`isOwner()`または`currentUserId()`必須。
- バリデーションは**クライアント＋サーバ両側**（zod＋長さ上限）。入力は「敵かもしれない」前提。
- 外部fetchは**`isSafeFetchUrl`(SSRF)**、`<a href>`は**`safeHttpUrl`(XSS)**を必ず通す。`dangerouslySetInnerHTML`は使わない。SQLは必ずプレースホルダ(`?`/drizzle`sql`)、`sql.raw`+文字列連結は禁止。
- エラー詳細(DB情報/パス/バージョン/スタック)を**レスポンスに出さない**。クライアントには汎用文、詳細は`console.error`/ログのみ。
- ログに**PII(email等)を残さない**。識別は`uid`等の非PIIキー（IP/UAは収集しない＝匿名性方針）。

## 第二条 コスト
- LLM/DB課金の単位を実装前に把握。**ループ呼び出しは必ず上限**(`stepCountIs`/`withRetry`3回/件数limit)。
- 公開ホットパスは**毎アクセスでTursoを叩かない**（キャッシュ/revalidateを検討＝読み取り課金の線形増を防ぐ）。
- 予算アラート/ハードリミットはダッシュボード側で要設定（コード外の手動タスク）。

## 第三条 法務（着手前に問う・最重要の事前確認）
- **スクレイピング可否**: 各情報源のToS/robots.txtを尊重。収集・AI解析(=非享受目的)は著作権法30条の4で広く許容されるが、**抽出本文(rawContent)の一般公開=公衆送信は享受目的で射程外＝侵害リスク**。公開UIは**要約＋元記事リンク＋分析に限定**（本文の逐語再表示はしない。`getArticleById`はオーナー時のみrawContentを返す実装）。
- **個人情報**(個情法/GDPR): 保持PIIは最小化(email/name/imageのみ)。利用目的明示・**削除/消去の動線**・米国移転の明記。公開ログインはEU居住者も来る＝GDPR適用前提。
- **ライブラリライセンス**: GPL/AGPL汚染の回避（現状は全てMIT/Apache/ISC）。新規依存は公式リポ/更新1年内/スター/ライセンスを確認。
- **AI生成物**: 要約は変形的に・**断定回避**（誤情報の信用毀損/名誉毀損を避ける）。免責は利用規約§6/§7に明記済み。
- **業法**(医療/金融/法律): 助言業に踏み込まない。チャットも技術領域にスコープ＋免責。

## 第四条 使い捨てでないアプリ
- 途中落ち前提: **冪等**(`onConflictDo*`)・多段書込はトランザクション境界を意識。
- **テスト**: 純粋ロジックはユニットテスト（`npm test`＝node:test+tsx）。説明できないものはリリースしない。
- **DRY**: 同一ロジックの2箇所コピーを避ける（例: markdownToHtmlは共通lib）。
- 構成: Git必須・secretsは`.gitignore`・**dev/本番のDBは分離**（ローカルは別Turso/ブランチDBを使う）。
- **本番スキーマ変更の罠**: 列追加等のmigrationは**push前に本番Tursoへ適用**する。未適用のままpushすると、全カラムselect（週次/月次/backup）や`ingestKnowledge`のUPDATEが**本番だけ**SQLエラーになる（ローカルは通るので気づけない）。詳細 [[reference-dev-env]]。

## 第五条 性能
- ループ内DB問い合わせ(N+1)を避ける（バッチ/Promise.all）。大規模検索はindex前提（vector/FTS済）。
- 「現状の設計が何件まで耐えるか」を把握する。

## 第六条 失敗対応
- 障害時はまず**止める**(キル/メンテ手段)→記録→早期通知("調査中"でOK)→**根本原因を仕組みで**再発防止。個人ミスで終わらせない。
- ランタイム異常は検知・通知できるようにする（パイプ失敗はメール通知済み）。

## 付録: AIに問う観点
STRIDE / OWASP Top10 / ASVS / 最小権限 / Defense in Depth / IDOR・XSS・CSRF・SQLi・SSRF・XXE / ACID・冪等性 / SLI/SLO / bcrypt・Argon2・OIDC・PKCE・WebAuthn・MFA

---

# 行動原則（毎タスクで守る）

1. **Surgical Changes（差分最小）**: 依頼に直接関係するファイル/行だけ触る。無関係なリファクタ・整形・「ついで改善」をしない。既存のフォーマット/コメント/命名を保つ。部分コミットでschemaと利用側の不整合を作らない。
2. **Think Before Coding（曖昧さ排除）**: 書く前に「変更対象ファイル」「実装方針」「検証方法」を言語化。前提が曖昧なら確認する。提案は一度きれいに出してGOをもらう。
3. **Goal-Driven（検証を先に決める）**: 完了条件＝何がどうなれば成功かを先に決め、実機/テストで確かめてから「できた」と言う。UI変更はPlaywrightスクショで実機検証。
4. **Simplicity First（過剰設計回避）**: 最小で要件を満たす。将来用の抽象/汎用化を先回りしない。
5. **破壊操作は事前確認**: 新規依存の追加、ファイル削除、git push、本番DB変更、外部送信は、durableな許可がない限り確認してから。

着手前は [[vibe-check]] の6条、risky な変更のコミット前は [[precheck]]（マルチエージェント・レビュー）を回す。

## 記録の規約
- **判断ログ**: コード単位の意思決定（決めたこと＋やめた案の理由）は機能完成時に `docs/decisions.md` に1段落追記する。
- **debug-log**: 解決に30分以上かかった問題は「症状→再現→原因→対処」をメモリ（`memory/`）に保存し再発を仕組みで防ぐ（例: OneDrive×.next の EPERM、未コミットschemaで本番だけ失敗、WSL日本語パス文字化け）。

---

# 現状サマリ（Knowledge Tree）

自走型AI技術情報収集・レポーティングシステム。個人利用＋公開マルチユーザー（Googleログイン）。

- **スタック**: Next.js 16 + Turso(libSQL) + Drizzle ORM + Gemini 2.5 Flash Lite（メイン）/ Flash（重要レポート）。
- **デプロイ/運用**: Vercel（Root Directory = `v2`、git push で自動）。GitHub Actions が毎日06:00 JSTに `daily_pipeline.ts` 実行（収集→知識抽出→レポート→夜間リサーチ）。
- **埋め込み**: gemini-embedding-001 / 768次元 / 非対称（文書=RETRIEVAL_DOCUMENT・クエリ=RETRIEVAL_QUERY）。
- **検索/RAG**: ハイブリッド3エンジン = vector + FTS5（CJK trigram）+ GraphRAG。チャンク(`content_chunks`)埋め込み＋RRF統合、`fetch_article`ドリルダウン。チャットも夜間リサーチも自前コーパスRAGで完結（外部検索はほぼ廃止）。
- **収集**: 無料フィード巡回（RSS/HN/ArXiv/GitHub等）＋ドメイン→フィード自動発見＋フィード自己監視＋本文ディープ抽出（LLM不使用）。
- **共有エンジン**: `src/lib/knowledge-ai.ts` の `askKnowledgeAI(task)` — 標準ツール付きDB接続AI。レポート/問い生成/横断洞察がここ経由。
- **UI**: 公開UIに全員統一（旧オーナー専用UIは撤去）。記事/レポートは全画面ページ＋Intercepting Routes。`getCoreData`/`getAnalyticsData` でServer Actionをバンドル。

詳細は memory の [[project-overview]] / [[reference-auth]] / [[reference-deploy]] / [[public-ui-overhaul]] / [[reference-dev-env]] を参照（v3/v4/v4.5の完了済み実装計画はそちらに集約）。

# 進行中の課題

現フェーズ = **「DBの状態がシステムの行動を決める」DB主導化＋DB精度の極大化**（精度＞コスト削減）。詳細・判断理由は [[current-phase-plan]]。

- **DB精度**: A/B/C/D/E 完了。残=B任意（汎用表記ゆれを `normalizeEntityKey` の決定論alias `ENTITY_ALIAS_KEYS` に追加して再発防止）。**遡及補正は再抽出せず直接UPDATE**（再抽出は confidence_score を0.7にリセットする仕様のため）。
- **DB主導化（未着手）**: ① Epistemic Pull Collection（DB状態が収集クエリ生成）/ ② 抽出深さをDB状態で決定 / ③ 夜間調査の戦略分岐（origin別）/ ④ 週次・月次・LearningRecap を knowledgeAI 移行。
- **次テーマ**: ② コーパス精度（収集記事の質）/ ③ 読み込み速度（**ボトルネック計測から**・[[feedback-evolve-nplus1]]）。
- **検索0%の最終スイッチ**: 無料フィードをCI数サイクル熟成 → `scripts/measure_v4.ts` 再計測で検索のユニーク貢献が無料に吸収されたか確認 → 吸収済なら keywordRounds=0（劣化させない順序）。

---

# リポジトリの .md と参照ガイド（こういう時だけ読む）

毎セッション読むのはこのファイルだけ。下記は**その作業をするときだけ**開く（常時ロードしない）。

## v2/（本体・Next.js 16アプリ）
- **AGENTS.md** — 冒頭で`@import`済（常時有効）。Next.js 16は破壊的変更あり → **コードを書く前に** `node_modules/next/dist/docs/` の該当ガイドを読む。
- **docs/decisions.md** — 設計判断ログ。**機能を完成させたら**「決定/理由/不採用/影響」を1段落追記。「なぜこうなってる？」を遡るときも読む。
- **LINT_CLEANUP.md** — ESLint方針の記録（✅解決済・参考）。**lintで詰まったとき**だけ。
- **READING_DNA_MODULE.md** — 読書DNA／スマートダイジェストの**未着手**モジュール仕様。**その機能に着手するとき**だけ。
- **README.md** — create-next-appのデフォルト（中身なし・無視可）。

## ルート/その他
- **README.md**（ルート）— 公開用README（特徴/セットアップ/env）。記述がやや古い（旧チャット等）→**公開文言を直すとき**に整合させる。
- **skills/*.md**（collect-web / evolve-sources / report-daily）— 旧Antigravity時代の手書きスキル定義。現在は `daily_pipeline.ts` に統合済の**レガシー**。基本触らない。
- **web/** — Vite+Reactテンプレの残骸（未使用の旧試作）。本体は v2/。

## memory/（関連時に自動想起・索引=MEMORY.md）
作業前に MEMORY.md で当たりをつけ、該当ファイルだけ開く。主要: [[project-overview]]（全体）/ [[current-phase-plan]]（現フェーズ全計画）/ [[reference-auth]]（認証）/ [[reference-deploy]]（デプロイ）/ [[reference-dev-env]]（ローカルdevの罠・DB識別）/ [[reference-data-and-cron]]（データ格納形式/cron）。
