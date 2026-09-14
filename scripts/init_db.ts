import db from "../src/core/db";

const initialSeeds = [
  { type: 'keyword', value: 'Gemini 1.5 Flash' },
  { type: 'keyword', value: 'Claude 3.5 Sonnet' },
  { type: 'keyword', value: 'Mastra AI Framework' },
  { type: 'keyword', value: 'OpenAI o1' },
  { type: 'keyword', value: 'AI Agent Architecture' },
  { type: 'keyword', value: 'MCP (Model Context Protocol)' },
  { type: 'keyword', value: 'LangGraph' },
  { type: 'keyword', value: 'Vercel AI SDK' }
];

function initSeeds() {
  console.log("--- Initializing Database Seeds ---");
  const insert = db.prepare('INSERT OR IGNORE INTO sources (type, value, status, score) VALUES (?, ?, ?, ?)');
  
  for (const seed of initialSeeds) {
    insert.run(seed.type, seed.value, 'active', 10.0); // 初期シードはスコア高めで開始
    console.log(`Added seed: ${seed.value}`);
  }
  
  console.log("--- Seeds Initialized Successfully ---");
}

initSeeds();
