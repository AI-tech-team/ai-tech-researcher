import { sqliteTable, text, integer, real, unique } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // 'keyword', 'channel', 'user'
  // UNIQUE が無いと、3箇所の insert が付けている .onConflictDoNothing() が
  // 衝突対象を持てず全て空振りする（＝同じURLが何行でも入る）。実測では itmedia topstory が
  // 33行に増え、重み付き抽選で他フィードの33倍引かれていた。user_topic_weights.keyword で
  // 踏んだのと同じ型。→ [[feedback-action-side-effects]]
  value: text("value").notNull().unique(),
  status: text("status").default('candidate'), // 'candidate', 'active', 'low-priority', 'stopped'
  score: real("score").default(0),
  lastHitAt: text("last_hit_at"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const collectedData = sqliteTable("collected_data", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").references(() => sources.id),
  title: text("title"),
  titleJa: text("title_ja"), // v3.1: 英語タイトルの日本語訳（表示用）
  url: text("url").unique(),
  summary: text("summary"),
  category: text("category"),
  isFavorited: integer("is_favorited").default(0),
  isReadLater: integer("is_read_later").default(0),
  isRead: integer("is_read").default(0),
  importanceScore: integer("importance_score").default(5),
  // 「その記事がAI・機械学習の技術そのものを扱っているか」を 0-10 で持つ。
  // ⚠ importance_score と**必ず別の列**にすること。1つのスカラーに「AIの話か」と
  // 「記事として重要か」を兼任させていた頃、よく書けた無関係記事が高得点になり、
  // 「新潟駅徒歩圏で完結する1泊2日観光モデルルート」★9 が朝刊の候補に入っていた
  // （2026-09-12 実測）。プロンプトで指示しても直らず、構造で分けて解決した。
  // NULL = 未判定（2026-09-13 の列追加より前に収集した記事）。表示側は NULL を落とさない。
  aiRelevance: integer("ai_relevance"),
  normalizedImportanceScore: integer("normalized_importance_score"),
  tags: text("tags"), // JSON array: '["tag1","tag2"]'
  // v7: 記事ページ用の「要点」。抽出本文(rawContent)は著作権上一般公開できないため(第三条)、
  // 本文の切り出しではなくLLMが書き起こした要点3〜5行＋「なぜ重要か」1行を持たせる。
  keyPoints: text("key_points"), // JSON array: '["要点1","要点2",...]'
  whyMatters: text("why_matters"),
  rawContent: text("raw_content"),
  // v3 Phase3: 本文抽出の試行記録。これが無いと「枯渇で未試行」と「試行して失敗」を区別できず、
  // 抽出率を上げても効果を測れない。extractError は集計用の短い固定タグ（http_404/timeout等）。
  extractAttemptedAt: text("extract_attempted_at"),
  extractAttempts: integer("extract_attempts").default(0),
  extractError: text("extract_error"),
  // 知識抽出の実施記録。これが無いと「まだ抽出していない記事」を選べず1日窓に頼るしかなく、
  // 窓を過ぎた記事は永久に抽出されない（実測: 9,093件が未抽出のまま）。
  // claims が0件だった記事もここに時刻を入れる＝「0件」と「未実施」を混同すると、
  // 抽出できない記事を毎日引き直して枠を食い潰す。→ [[pattern-throughput-starvation]]
  knowledgeExtractedAt: text("knowledge_extracted_at"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  // v3ベクトル基盤: 同一ストーリーの代表記事ID（自己参照）と束ねた記事数
  storyId: integer("story_id"),
  storyCount: integer("story_count").default(1),
  // 知識抽出ロジックのバージョン。現EXTRACTION_VERSION未満の記事をBatchで再抽出する（遡及適用）
  extractionVersion: integer("extraction_version").default(0),
  // embedding (F32_BLOB) はDrizzle非対応のため生SQLで管理（select時に巨大blobを引かないようスキーマ外）
  // search_tokens (TEXT) も同じ理由でスキーマ外。kuromojiで形態素解析した索引語を空白区切りで持ち、
  // search_fts(FTS5)がトリガで同期する。書き込みは daily_pipeline、検索は actions.ts の生SQL。
});

export const reports = sqliteTable("reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // 'daily', 'weekly', 'monthly'
  content: text("content"),
  reportDate: text("report_date").notNull(), // 'YYYY-MM-DD'
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const adoptionLogs = sqliteTable("adoption_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportId: integer("report_id").references(() => reports.id),
  sourceId: integer("source_id").references(() => sources.id),
  isAdopted: integer("is_adopted"), // 1 or 0
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const pipelineLogs = sqliteTable("pipeline_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  collected: integer("collected").default(0),
  failed: integer("failed").default(0),
  durationMs: integer("duration_ms").default(0),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const claims = sqliteTable("claims", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  articleId: integer("article_id").references(() => collectedData.id),
  subject: text("subject").notNull(),
  predicate: text("predicate").notNull(),
  value: text("value").notNull(),
  confidence: text("confidence").default('medium'), // 'high', 'medium', 'low'
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  // v3知識グラフ: 正規化エンティティ・時系列バージョニング
  entityId: integer("entity_id"),
  validFrom: text("valid_from"),       // YYYY-MM-DD（記事公開日 or 収集日）
  status: text("status").default('active'), // 'active' | 'stale'
  // 確信度スペクトル: 0-1 float。日次decayと裏付けブーストで変動。0.25未満でstale自動移行
  confidenceScore: real("confidence_score").default(0.7),
});

// v3: エンティティ正規化（GPT-4o / GPT4o / gpt-4 omni → 同一ノード）
export const entities = sqliteTable("entities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  canonicalName: text("canonical_name").notNull(),
  normalizedKey: text("normalized_key").notNull().unique(), // 小文字英数字のみ。重複排除キー
  type: text("type").default('model'), // 'model' | 'company' | 'benchmark' | 'method' | 'other'
  aliases: text("aliases"), // JSON配列
  mentionCount: integer("mention_count").default(1),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// v3: ベンチマーク自動トラッキング（数値クレームの構造化）
export const benchmarks = sqliteTable("benchmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityId: integer("entity_id").references(() => entities.id),
  entityName: text("entity_name").notNull(),   // 正規化済み代表名（denormalized）
  benchmarkName: text("benchmark_name").notNull(),
  score: real("score").notNull(),
  unit: text("unit"), // '%', 'points', 'Elo' 等
  articleId: integer("article_id").references(() => collectedData.id),
  sourceUrl: text("source_url"),
  recordedDate: text("recorded_date"), // YYYY-MM-DD
  confidence: text("confidence").default('medium'),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// v3: 知識グラフの関係エッジ
export const relations = sqliteTable("relations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subjectEntityId: integer("subject_entity_id").references(() => entities.id),
  subjectName: text("subject_name").notNull(),
  // 値は src/lib/knowledge-quality.ts の RELATION_TYPES（すべて能動態＝subjectが行為者）。
  // 旧 acquired_by は向きが壊れるため 2026-09-10 に廃止し acquires へ置き換えた。
  relationType: text("relation_type").notNull(),
  objectEntityId: integer("object_entity_id").references(() => entities.id),
  objectName: text("object_name").notNull(),
  articleId: integer("article_id").references(() => collectedData.id),
  confidence: text("confidence").default('medium'),
  validFrom: text("valid_from"), // YYYY-MM-DD
  status: text("status").default('active'), // 'active' | 'stale' | 'inferred'
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const userTopicWeights = sqliteTable("user_topic_weights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  keyword: text("keyword").notNull(),
  weight: real("weight").default(0),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
}, (t) => [unique().on(t.userId, t.keyword)]);

// v3: 夜間自律リサーチが自動生成した「問い」とその調査結果
export const researchQuestions = sqliteTable("research_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  question: text("question").notNull(),
  origin: text("origin").notNull(), // 'followup' | 'gap' | 'tracking' | 'contradiction'
  originRef: text("origin_ref"),     // 記事ID/キーワード等の根拠
  articleId: integer("article_id").references(() => collectedData.id),
  status: text("status").default('pending'), // 'pending' | 'investigated' | 'failed'
  findings: text("findings"),        // Grounding調査結果
  findingsUrl: text("findings_url"), // 調査で見つけた代表URL
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  investigatedAt: text("investigated_at"),
});

// v3.1 読書DNA: ユーザーの記事行動ログ（4軸プロファイル算出の元データ）
export const readingEvents = sqliteTable("reading_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"), // v6: マルチユーザー（null=旧データ/オーナー）
  articleId: integer("article_id").references(() => collectedData.id),
  action: text("action").notNull(), // 'open' | 'favorite' | 'readlater' | 'read'
  weight: real("weight").default(1),
  category: text("category"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// v6: ユーザープロフィール（1ユーザー1行）。表示名・興味・目標・メール購読
export const userProfiles = sqliteTable("user_profiles", {
  userId: integer("user_id").primaryKey(),
  displayName: text("display_name"),
  interests: text("interests"),   // 興味（自由記述/カンマ区切り）
  goals: text("goals"),           // 今調べていること・目標
  emailOptIn: integer("email_opt_in").default(0), // 1=パーソナライズ朝briefをメール受信
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// v6: ユーザー別の記事状態（お気に入り/後で読む/既読）。記事は共有・状態はユーザー別
export const userArticleState = sqliteTable("user_article_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  articleId: integer("article_id").notNull(),
  isFavorited: integer("is_favorited").default(0),
  isReadLater: integer("is_read_later").default(0),
  isRead: integer("is_read").default(0),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
}, (t) => [unique().on(t.userId, t.articleId)]);

// v3: 理由付き先読みアラート
export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // 'benchmark_lead_change' | 'new_competitor' | 'tracking_surge' | 'contradiction'
  title: text("title").notNull(),
  reason: text("reason").notNull(), // 「なぜ通知するか」
  entityName: text("entity_name"),
  severity: text("severity").default('watch'), // 'info' | 'watch' | 'high'
  relatedArticleId: integer("related_article_id").references(() => collectedData.id),
  dedupeKey: text("dedupe_key").notNull().unique(), // 同一アラートの重複防止
  status: text("status").default('active'), // 'active' | 'dismissed'
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// C: 長期記憶。チャットの発話をユーザー別にベクトル保存し、セッションを跨いで文脈を継続。
// embedding (F32_BLOB) はDrizzle非対応のため生SQLで管理（スキーマ外）。
export const chatMemory = sqliteTable("chat_memory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// v6: マルチユーザー（Googleログイン）。記事/知識グラフは共有、ユーザー別データはuserIdで分離
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// v10: Web Push通知の購読。ログイン不要（匿名でも購読可＝userIdはnull許容・PIIは持たない）。
// endpointはブラウザ発行のプッシュサービスURL。p256dh/authは暗号化キー（この3点でのみ送信でき、
// 端末や個人は特定しない）。日次ダイジェスト生成時にパイプラインが全購読へ送る。
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userId: integer("user_id"), // null=匿名購読
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});
