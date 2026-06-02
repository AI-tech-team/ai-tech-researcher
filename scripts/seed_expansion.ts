import { askGemini } from "../src/core/llm";
import db from "../src/core/db";

async function expandSeeds() {
  console.log("--- Expanding Seeds to 200 (Latest Tech Trends) ---");

  const prompt = `
Generate a list of exactly 200 unique, high-quality technical keywords or names of tools/frameworks/models that an "AI Tech Researcher" should track in 2026. 
Include the following categories:
- Latest LLMs and AI Models (OpenAI, Google, Anthropic, Meta, DeepSeek, etc.)
- AI Agent Frameworks and Orchestration (Mastra, LangGraph, CrewAI, PydanticAI, etc.)
- Infrastructure and Ops (Vector DBs, GPU optimization, Edge AI, WebAssembly)
- Web Development Trends (React 19, Next.js, Bun, Rust-based tools)
- AI Security and Ethics
- Emerging tech (Quantum, Neuro-symbolic AI)

Output only the keywords as a comma-separated list. No numbering, no descriptions.
`;

  try {
    const response = await askGemini(prompt);
    // LLM出力は指示どおりにならないことがある（前置き文・箇条書き・番号・コードフェンス等）。
    // 検証せず投入すると sources にゴミキーワードが混入し収集を汚染するため、サニタイズ＋件数チェックする。
    const cleaned = response.replace(/```[a-z]*/gi, '').replace(/```/g, '');
    const keywords = [...new Set(
      cleaned.split(',')
        .map(k => k.trim()
          .replace(/^[-*•\d.)\s]+/, '') // 行頭の箇条書き記号・番号を除去
          .replace(/[\r\n]+/g, ' ')
          .trim())
        .filter(k => k.length >= 2 && k.length <= 60 && /[A-Za-z0-9]/.test(k))
    )];

    console.log(`Generated ${keywords.length} keywords (sanitized).`);
    // 想定件数を大きく外れる回はLLM出力が崩れた蓋然性が高いので投入を中止（ゴミ大量混入を防ぐ）
    if (keywords.length < 20 || keywords.length > 400) {
      console.warn(`キーワード数が想定範囲外(${keywords.length})。LLM出力が崩れた可能性があるため投入を中止します。`);
      return;
    }

    const insert = db.prepare('INSERT OR IGNORE INTO sources (type, value, status, score) VALUES (?, ?, ?, ?)');
    
    let count = 0;
    db.transaction(() => {
      for (const kw of keywords) {
        const result = insert.run('keyword', kw, 'active', 10.0);
        if (result.changes > 0) count++;
      }
    })();

    console.log(`Successfully added ${count} new unique seeds to the database.`);
    
    // 現在のシード数を確認
    const total = db.prepare('SELECT COUNT(*) as count FROM sources').get() as any;
    console.log(`Total seed count in DB: ${total.count}`);

  } catch (e) {
    console.error("Failed to expand seeds:", e);
  }
}

expandSeeds();
