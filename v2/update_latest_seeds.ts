import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from './src/db/index';
import { sources } from './src/db/schema';

const latestKeywords = [
  "GPT-4o realtime API", "Gemini 1.5 Pro Flash updates", "Claude 3.5 Opus release rumors",
  "Apple Intelligence iOS 18", "Llama 3 400B", "Mistral Codestral", "Sora public beta",
  "Vercel AI SDK 3.1", "Next.js 15 RC", "React 19 Server Components", "Devin AI software engineer alternatives",
  "OpenAI Spring Update 2026", "AI Agents for browser automation", "Local LLMs on Snapdragon X Elite",
  "Copilot+ PCs", "AI PC NPUs", "WebGPU AI inference"
];

async function updateKeywords() {
  console.log("Updating database with latest 2026 keywords...");
  let count = 0;
  for (const kw of latestKeywords) {
    try {
      await db.insert(sources).values({
        type: 'keyword',
        value: kw,
        status: 'active',
        score: 10.0,
      }).onConflictDoNothing();
      count++;
    } catch (e) {
      console.error(`Error inserting ${kw}:`, e);
    }
  }
  console.log(`Successfully added ${count} ultra-latest keywords to Turso DB!`);
}

updateKeywords().catch(console.error);
