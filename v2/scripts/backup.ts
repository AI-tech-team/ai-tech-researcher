import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as schema from '../src/db/schema';

config({ path: '.env.local' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client, { schema });

async function backup() {
  const date = new Date().toISOString().split('T')[0];
  const dir = join(process.cwd(), 'backups');
  mkdirSync(dir, { recursive: true });

  const [sources, collectedData, reports, adoptionLogs, pipelineLogs] = await Promise.all([
    db.select().from(schema.sources),
    db.select().from(schema.collectedData),
    db.select().from(schema.reports),
    db.select().from(schema.adoptionLogs),
    db.select().from(schema.pipelineLogs),
  ]);

  const backup = { date, sources, collectedData, reports, adoptionLogs, pipelineLogs };
  const filePath = join(dir, `backup_${date}.json`);
  writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8');

  console.log(`[Backup] 完了: ${filePath}`);
  console.log(`  sources: ${sources.length}件`);
  console.log(`  collectedData: ${collectedData.length}件`);
  console.log(`  reports: ${reports.length}件`);
  process.exit(0);
}

backup().catch(e => { console.error(e); process.exit(1); });
