import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from './src/db/index';
import { sources } from './src/db/schema';

const keywords = [
  "Transformer", "LLM", "Attention Mechanism", "Parameters", "Multi-modal", "Tokenization", "GPT", "Diffusion Model", "MoE", "Context Window",
  "Pre-training", "Fine-tuning", "RLHF", "LoRA", "Transfer Learning", "Self-supervised Learning", "Few-shot Learning", "Zero-shot Learning", "Instruction Tuning", "Knowledge Distillation",
  "Prompt Engineering", "RAG", "Chain of Thought", "In-context Learning", "Vector Database", "Embedding", "Semantic Search", "Temperature", "Hallucination", "Inference",
  "Generative AI", "Text-to-Image", "Text-to-Video", "Text-to-Music", "Code Generation", "Synthetic Data", "Deepfake", "Conversational AI", "Image-to-Image", "Speech Synthesis",
  "AI Agent", "AutoGPT", "Autonomous Systems", "Copilot", "Reasoning", "Task Planning", "Tool Use", "Robotic Process Automation", "Human-in-the-loop", "Swarm Intelligence",
  "AI Ethics", "Alignment", "Explainable AI / XAI", "Bias", "Copyright", "Data Privacy", "Safety Guardrails", "AI Governance", "Responsible AI", "Red Teaming",
  "GPU", "TPU", "H100/B200", "Cloud AI", "Edge AI", "Compute", "On-device AI", "Quantum AI", "Scalability", "Data Center",
  "Neural Network", "Backpropagation", "Gradient Descent", "Stochastic", "Weights and Biases", "Activation Function", "Loss Function", "Latent Space", "Regularization", "Overfitting",
  "SaaS", "Open Source AI", "Proprietary AI", "Data Sovereignty", "Personalization", "AI Act", "Digital Twin", "Bio-AI", "FinTech AI", "EdTech AI",
  "AGI", "ASI", "Singularity", "Scaling Laws", "Emergent Abilities", "Human-AI Collaboration", "Embodied AI", "World Model", "Turing Test", "Democratic AI"
];

async function insertUserKeywords() {
  console.log("Inserting user provided 100 keywords...");
  let count = 0;
  for (const kw of keywords) {
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
  console.log(`Successfully added ${count} new keywords from the user list!`);
}

insertUserKeywords().catch(console.error);
