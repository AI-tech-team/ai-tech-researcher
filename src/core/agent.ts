import { model } from "./llm";
import db from "./db";
import fs from "fs";
import path from "path";

/**
 * AI Tech Researcher Agent
 * This agent reads a "Skill" (markdown instruction) and executes it using Gemini.
 */
export class ResearcherAgent {
  private skillPath: string;

  constructor(skillName: string) {
    this.skillPath = path.join(__dirname, "../../skills", `${skillName}.md`);
  }

  async run(maxTurns: number = 10) {
    if (!fs.existsSync(this.skillPath)) {
      throw new Error(`Skill not found: ${this.skillPath}`);
    }

    const skillContent = fs.readFileSync(this.skillPath, "utf-8");
    const systemPrompt = `
You are an AI Tech Researcher. Your goal is to execute the following "Skill" (instructions).
You have access to a SQLite database and can read/write files.

Current Date: ${new Date().toISOString().split('T')[0]}

### DB Schema Info:
- sources: (id, type, value, status, score)
- collected_data: (source_id, title, url, summary, raw_content, published_at)
- reports: (id, type, content, report_date)
- adoption_logs: (report_id, source_id, is_adopted)

### Tools:
1. SQL_QUERY: Execute a SQL query on the database.
   ARGS: { "query": "SELECT * FROM sources", "params": [] }
2. WEB_SEARCH: Search for technical information (Zenn, Qiita, etc.)
   ARGS: { "query": "keyword" }
3. FILE_WRITE: Write content to a file.
   ARGS: { "path": "relative/path", "content": "..." }

To use a tool, YOU MUST format your response as:
TOOL: [TOOL_NAME]
ARGS: [JSON_ARGS]

Wait for the tool output before proceeding. Do one tool call at a time.
If you have finished the task, provide a summary.
`;

    let history: any[] = [
      { role: "user", parts: [{ text: `Skill to execute:\n\n${skillContent}` }] }
    ];

    console.log(`Starting skill execution: ${path.basename(this.skillPath)}`);

    for (let i = 0; i < maxTurns; i++) {
      const chat = model.startChat({
        history: history,
        systemInstruction: systemPrompt,
      });

      const result = await chat.sendMessage("Proceed with the next step according to the skill instructions.");
      const responseText = result.response.text();
      
      console.log(`\n--- Turn ${i + 1} ---`);
      console.log(responseText);

      history.push({ role: "model", parts: [{ text: responseText }] });

      // Parse tool calls
      if (responseText.includes("TOOL:")) {
        const toolMatch = responseText.match(/TOOL:\s*(\w+)/);
        const argsMatch = responseText.match(/ARGS:\s*(\{[\s\S]*?\})/);

        if (toolMatch && argsMatch) {
          const toolName = toolMatch[1];
          try {
            const args = JSON.parse(argsMatch[1]);
            const output = await this.executeTool(toolName, args);
            
            console.log(`[Tool Output]: ${output.substring(0, 100)}...`);
            history.push({ role: "user", parts: [{ text: `TOOL_OUTPUT: ${output}` }] });
            continue;
          } catch (e) {
            console.error("Failed to parse tool args:", e);
            history.push({ role: "user", parts: [{ text: `TOOL_ERROR: Invalid JSON in ARGS.` }] });
            continue;
          }
        }
      }

      // If no tool call, assume completion
      if (!responseText.includes("TOOL:")) {
          console.log("No tool call detected. Finishing skill.");
          break;
      }
    }

    console.log("Skill execution finished.");
  }

  private async executeTool(name: string, args: any): Promise<string> {
    switch (name) {
      case "SQL_QUERY":
        try {
          const rows = db.prepare(args.query).all(args.params || []);
          return JSON.stringify(rows);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      case "WEB_SEARCH":
        // Improved mock search that looks like Zenn results
        return JSON.stringify([
          { title: `${args.query}についての最新動向`, url: `https://zenn.dev/search?q=${encodeURIComponent(args.query)}&1`, summary: `${args.query}を活用した開発事例が増えています。` },
          { title: `${args.query}の徹底解説`, url: `https://qiita.com/search?q=${encodeURIComponent(args.query)}&2`, summary: `${args.query}の内部構造とパフォーマンスについて。` }
        ]);
      case "FILE_WRITE":
        const fullPath = path.join(__dirname, "../../", args.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, args.content);
        return "File written successfully.";
      case "SLACK_COLLECT":
        // Placeholder for Slack collection logic
        return `Slack collection from channel "${args.channel}": [Mock: "User A mentioned Mastra", Mock: "User B shared a link to Claude Code article"]`;
      default:
        return "Unknown tool.";
    }
  }
}
