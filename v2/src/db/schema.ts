import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
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
  url: text("url").unique(),
  summary: text("summary"),
  category: text("category"),
  isFavorited: integer("is_favorited").default(0),
  isReadLater: integer("is_read_later").default(0),
  isRead: integer("is_read").default(0),
  importanceScore: integer("importance_score").default(5),
  tags: text("tags"), // JSON array: '["tag1","tag2"]'
  rawContent: text("raw_content"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
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
