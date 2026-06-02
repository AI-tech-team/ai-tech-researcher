import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';

config({ path: '.env.local' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client, { schema });

const TARGET_URL = 'https://techdrip.net';

async function main() {
  // sources.value に UNIQUE 制約が無いため onConflictDoNothing は発火しない（毎回重複INSERTになる）。
  // 重複登録を防ぐため、挿入前に value で存在確認する（daily_pipeline.ts ensureSources と同方式）。
  const existing = await db.select({ id: schema.sources.id })
    .from(schema.sources).where(eq(schema.sources.value, TARGET_URL)).limit(1);

  if (existing.length > 0) {
    console.log(`既に存在します (スキップ): ${TARGET_URL}`);
    process.exit(0);
  }

  await db.insert(schema.sources).values({
    type: 'url',
    value: TARGET_URL,
    status: 'active',
    score: 0,
  });
  console.log(`追加完了: ${TARGET_URL} (type=url, status=active)`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
