import { ResearcherAgent } from "../src/core/agent";

async function runDailyPipeline() {
  console.log("--- Starting Daily Pipeline ---");
  
  // 1. Web収集
  console.log("\n[1/3] Collecting Web Data...");
  const collector = new ResearcherAgent("collect-web");
  await collector.run(15);

  // 2. レポート生成
  console.log("\n[2/3] Generating Daily Report...");
  const reporter = new ResearcherAgent("report-daily");
  await reporter.run(10);

  // 3. ソース進化
  console.log("\n[3/3] Evolving Sources...");
  const evolver = new ResearcherAgent("evolve-sources");
  await evolver.run(10);

  console.log("\n--- Daily Pipeline Completed ---");
}

runDailyPipeline().catch(console.error);
