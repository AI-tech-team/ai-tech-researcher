import { config } from 'dotenv';
config({ path: '.env.local' });

async function listModels() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();
  const models = data.models?.map((m: any) => m.name).filter((n: string) => n.includes('gemini'));
  console.log("Available Gemini models:");
  console.log(models);
}

listModels().catch(console.error);
