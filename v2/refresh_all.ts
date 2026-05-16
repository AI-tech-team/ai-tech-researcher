import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from './src/db/index';
import { sources, collectedData, reports } from './src/db/schema';
import { eq } from 'drizzle-orm';

const ultraLatestKeywords2026 = [
  "GPT-5 Turbo", "GPT-5 Omni", "Claude 4 Opus", "Claude 4.5 Sonnet", "Llama 4 400B", "Llama 4 1T",
  "Gemini 4.0 Pro", "Gemini 4.0 Ultra", "Grok 3", "Mistral 2 Large", "Qwen 3", "Sora 2.0 API",
  "V-JEPA 2", "Liquid Neural Networks 2026", "Jamba 2", "Mamba-3 architecture",
  "Inflection-3", "Cohere Command R++", "Stable Diffusion 4", "Midjourney v7",
  "Autonomous Agent Swarms 2026", "WebGPU LLM inference", "On-device GPT-5 Lite"
];

async function refreshAll() {
  console.log("🚀 [1/4] 古いデータを全削除（リセット）しています...");
  await db.delete(collectedData);
  await db.delete(reports);
  // 古いソース（1年前のもの）を非アクティブにするか削除
  await db.delete(sources);

  console.log("🌱 [2/4] 2026年5月時点の「超最新」キーワードを登録しています...");
  for (const kw of ultraLatestKeywords2026) {
    try {
      await db.insert(sources).values({
        type: 'keyword',
        value: kw,
        status: 'active',
        score: 10.0,
      }).onConflictDoNothing();
    } catch (e) {
      // ignore unique constraint errors etc.
    }
  }

  console.log("🌐 [3/4] 最新データを一括で収集しています（5件）...");
  for (let i = 0; i < 5; i++) {
    try {
      console.log(`  - 収集中... (${i+1}/5)`);
      const res = await fetch('http://localhost:3000/api/collect', { method: 'POST' });
      if (!res.ok) throw new Error("Collect API failed");
    } catch (e: any) {
      console.error(`    エラー: ${e.message}`);
    }
  }

  console.log("📝 [4/4] 収集したデータからエグゼクティブ・レポートを生成しています...");
  try {
    const res = await fetch('http://localhost:3000/api/report', { method: 'POST' });
    if (!res.ok) throw new Error("Report API failed");
  } catch (e: any) {
    console.error(`    エラー: ${e.message}`);
  }

  console.log("✨ 全更新が完了しました！ブラウザをリロードしてください。");
}

refreshAll().catch(console.error);
