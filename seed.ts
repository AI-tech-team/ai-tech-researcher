import db from "./src/core/db";

const initialSources = [
  { type: 'keyword', value: 'Claude Code', status: 'active' },
  { type: 'keyword', value: 'Gemini 1.5 Flash', status: 'active' },
  { type: 'keyword', value: 'Mastra', status: 'candidate' },
  { type: 'keyword', value: 'AI Agent Framework', status: 'active' },
  { type: 'keyword', value: 'Vercel AI SDK', status: 'candidate' },
];

const insert = db.prepare('INSERT OR IGNORE INTO sources (type, value, status) VALUES (?, ?, ?)');

initialSources.forEach(s => {
  insert.run(s.type, s.value, s.status);
});

console.log("Database seeded with initial sources.");
