import { ResearcherAgent } from "./src/core/agent";

async function main() {
  const skill = process.argv[2] || "collect-web";
  const agent = new ResearcherAgent(skill);
  
  try {
    await agent.run(10); // Increase turns for better task completion
  } catch (error) {
    console.error("Error running agent:", error);
  }
}

main();
