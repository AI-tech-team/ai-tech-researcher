import { sqliteTable, text, integer, real, unique } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // 'keyword', 'channel', 'user'
  value: text("value").notNull(),
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
  normalizedImportanceScore: integer("normalized_importance_score"),
  tags: text("tags"), // JSON array: '["tag1","tag2"]'
  rawContent: text("raw_content"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  // v3ベクトル基盤: 同一ストーリーの代表記事ID（自己参照）と束ねた記事数
  storyId: integer("story_id"),
  storyCount: integer("story_count").default(1),
  // 知識抽出ロジックのバージョン。現EXTRACTION_VERSION未満の記事をBatchで再抽出する（遡及適用）
  extractionVersion: integer("extraction_version").default(0),
  // embedding (F32_BLOB) はDrizzle非対応のため生SQLで管理（select時に巨大blobを引かないようスキーマ外）
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
  relationType: text("relation_type").notNull(), // outperforms/competes_with/builds_on/acquired_by/cites/supersedes
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
