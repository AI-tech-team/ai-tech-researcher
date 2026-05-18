import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import * as schema from '../src/db/schema';

config({ path: '.env.local' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client, { schema });

async function main() {
  const res = await db.insert(schema.sources).values({
    type: 'url',
    value: 'https://techdrip.net',
    status: 'active',
    score: 0,
  }).onConflictDoNothing();

  if (res.rowsAffected > 0) {
    console.log('追加完了: https://techdrip.net (type=url, status=active)');
  } else {
    console.log('既に存在します (スキップ)');
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
