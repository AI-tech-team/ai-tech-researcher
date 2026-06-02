import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as schema from '../src/db/schema';

config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client, { schema });

async function backup() {
  const date = new Date().toISOString().split('T')[0];
  const dir = join(process.cwd(), 'backups');
  mkdirSync(dir, { recursive: true });

  // Drizzleで定義された全テーブルを網羅的にダンプ。
  // 知識グラフ(claims/entities/benchmarks/relations)・マルチユーザー状態・長期記憶を含め、
  // 事故/マイグレーション失敗時に復旧不能なデータを取りこぼさない。
  const tables: Record<string, any> = {
    sources: schema.sources,
    collectedData: schema.collectedData,
    reports: schema.reports,
    adoptionLogs: schema.adoptionLogs,
    pipelineLogs: schema.pipelineLogs,
    claims: schema.claims,
    entities: schema.entities,
    benchmarks: schema.benchmarks,
    relations: schema.relations,
    userTopicWeights: schema.userTopicWeights,
    researchQuestions: schema.researchQuestions,
    readingEvents: schema.readingEvents,
    userProfiles: schema.userProfiles,
    userArticleState: schema.userArticleState,
    alerts: schema.alerts,
    chatMemory: schema.chatMemory,
    users: schema.users,
  };

  const out: Record<string, any> = {
    date,
    // 埋め込み(F32_BLOB: collected_data.embedding / chat_memory.embedding / content_chunks.embedding)は
    // 容量が大きく毎週gitにコミットすると肥大化するため除外。本文/テキストから再生成可能:
    //   PIPELINE_MODE=reembed（記事）/ PIPELINE_MODE=chunks（チャンク）。
    note: 'embeddings(F32_BLOB)は容量のため除外。本文から PIPELINE_MODE=reembed/chunks で再生成可',
  };

  for (const [name, table] of Object.entries(tables)) {
    out[name] = await db.select().from(table);
  }

  // content_chunks はDrizzle定義外(生SQLマイグレーション)。本文テキストのみ退避（embeddingは除外）
  try {
    out.contentChunks = (await client.execute(
      `SELECT rowid AS rowid, article_id, text FROM content_chunks`
    )).rows;
  } catch (e: any) {
    console.warn('[Backup] content_chunks 取得スキップ:', e?.message ?? e);
    out.contentChunks = [];
  }

  const filePath = join(dir, `backup_${date}.json`);
  writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf-8');

  console.log(`[Backup] 完了: ${filePath}`);
  for (const [name, rows] of Object.entries(out)) {
    if (!Array.isArray(rows)) continue;
    console.log(`  ${name}: ${rows.length}件`);
  }
  process.exit(0);
}

backup().catch(e => { console.error(e); process.exit(1); });
