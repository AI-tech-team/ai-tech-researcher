import { config } from 'dotenv';
config({ path: '.env.local' });
import Database from 'better-sqlite3';
import { db } from './src/db/index';
import { sources } from './src/db/schema';
import path from 'path';

async function migrate() {
  console.log("Migrating data from local SQLite to Turso...");
  const localDb = new Database(path.join(__dirname, '../data/database.sqlite'));
  
  const localSources = localDb.prepare('SELECT * FROM sources').all() as any[];
  
  console.log(`Found ${localSources.length} sources to migrate.`);
  
  // Turso is remote, better to insert in batches or sequentially.
  let count = 0;
  for (const s of localSources) {
    try {
      await db.insert(sources).values({
        id: s.id,
        type: s.type,
        value: s.value,
        status: s.status,
        score: s.score,
        lastHitAt: s.last_hit_at,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      }).onConflictDoNothing();
      count++;
    } catch (e) {
      console.error(`Error inserting source ${s.id}:`, e);
    }
  }
  
  console.log(`Migrated ${count} sources.`);
}

migrate().catch(console.error);
