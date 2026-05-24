/** hybridSearch の単体動作確認。実行: v2/ で `npx tsx scripts/test_retrieval.ts` */
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

(async () => {
  // env ロード後に動的import（@/db のclientがenvを参照するため）
  const { hybridSearch } = await import('../src/lib/retrieval');
  for (const q of ['Geminiの性能', 'AI agent framework', 'RAG 検索精度', '量子コンピュータ']) {
    const docs = await hybridSearch(q, 6);
    console.log(`\n=== "${q}" → ${docs.length}件 ===`);
    docs.forEach(d => console.log(`  [imp${d.importance}|n${d.storyCount}] ${(d.titleJa || d.title || '').slice(0, 64)}`));
  }
  process.exit(0);
})();
