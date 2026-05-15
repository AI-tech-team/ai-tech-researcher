import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from './src/db/index';
import { sources } from './src/db/schema';

/**
 * 2026年5月時点で実在・注目されている正確なAI技術キーワード群
 * カテゴリ別に整理し、スコアで重要度を区別
 */
const seeds: { value: string; score: number }[] = [

  // ===== 基盤LLMモデル（実在・最新） =====
  { value: 'GPT-4o', score: 9.5 },
  { value: 'GPT-4.1', score: 9.5 },
  { value: 'o3 (OpenAI)', score: 9.5 },
  { value: 'o4-mini', score: 9.0 },
  { value: 'Claude 3.7 Sonnet', score: 9.5 },
  { value: 'Claude 3.5 Haiku', score: 9.0 },
  { value: 'Claude 4 Opus', score: 8.5 },
  { value: 'Gemini 2.5 Pro', score: 9.5 },
  { value: 'Gemini 2.5 Flash', score: 9.5 },
  { value: 'Gemini 3.1 Flash Lite', score: 9.0 },
  { value: 'Llama 4 Scout', score: 9.0 },
  { value: 'Llama 4 Maverick', score: 9.0 },
  { value: 'Llama 4 Behemoth', score: 8.5 },
  { value: 'DeepSeek-V3', score: 9.0 },
  { value: 'DeepSeek-R2', score: 9.0 },
  { value: 'Qwen3-235B-A22B', score: 9.0 },
  { value: 'Qwen3-32B', score: 8.5 },
  { value: 'Mistral Large 3', score: 8.5 },
  { value: 'Mistral Small 3.1', score: 8.0 },
  { value: 'Grok 3', score: 8.5 },
  { value: 'Grok 3 mini', score: 8.0 },
  { value: 'Phi-4', score: 8.5 },
  { value: 'Phi-4-mini', score: 8.0 },
  { value: 'Gemma 3', score: 8.5 },
  { value: 'Command R+', score: 8.0 },
  { value: 'DBRX', score: 7.5 },
  { value: 'Jamba 1.5', score: 7.5 },
  { value: 'Nemotron-70B', score: 8.0 },
  { value: 'Falcon 3', score: 7.5 },
  { value: 'SmolLM3', score: 7.5 },
  { value: 'Aya Expanse (Cohere)', score: 7.5 },
  { value: 'InternLM3', score: 7.5 },
  { value: 'Baichuan 3', score: 7.0 },
  { value: 'GLM-4', score: 7.5 },
  { value: 'MiniMax-Text-01', score: 7.5 },
  { value: 'Kimi k1.5', score: 8.0 },
  { value: 'Step-2', score: 7.5 },

  // ===== 推論・思考系モデル =====
  { value: 'chain-of-thought reasoning', score: 9.0 },
  { value: 'extended thinking (Claude)', score: 9.0 },
  { value: 'reasoning tokens', score: 8.5 },
  { value: 'test-time compute scaling', score: 9.0 },
  { value: 'Monte Carlo Tree Search for LLMs', score: 8.0 },
  { value: 'process reward model (PRM)', score: 8.5 },
  { value: 'outcome reward model (ORM)', score: 8.0 },
  { value: 'QwQ-32B', score: 8.5 },
  { value: 'R1-Zero', score: 8.5 },
  { value: 'DeepSeek-R1', score: 9.0 },

  // ===== コーディング特化モデル =====
  { value: 'Claude Code', score: 9.5 },
  { value: 'Codex (OpenAI 2025)', score: 8.5 },
  { value: 'Gemini Code Assist', score: 8.5 },
  { value: 'GitHub Copilot Workspace', score: 9.0 },
  { value: 'Cursor AI', score: 9.5 },
  { value: 'Windsurf (Codeium)', score: 9.0 },
  { value: 'Devin 2.0', score: 8.5 },
  { value: 'SWE-bench Verified', score: 8.5 },
  { value: 'OpenHands (OpenDevin)', score: 8.0 },
  { value: 'Aider', score: 8.0 },
  { value: 'Zed AI', score: 7.5 },

  // ===== マルチモーダル =====
  { value: 'GPT-4o Vision', score: 9.0 },
  { value: 'Gemini 2.5 Pro Vision', score: 9.0 },
  { value: 'Claude 3.7 Vision', score: 8.5 },
  { value: 'LLaVA-1.6', score: 7.5 },
  { value: 'Qwen-VL-2.5', score: 8.0 },
  { value: 'InternVL3', score: 8.0 },
  { value: 'Pixtral Large', score: 8.0 },
  { value: 'Gemini 2.0 Flash multimodal', score: 8.5 },
  { value: 'native audio output (Gemini)', score: 8.0 },
  { value: 'speech-to-speech model', score: 8.0 },

  // ===== 動画・画像生成 =====
  { value: 'Veo 3 (Google)', score: 9.0 },
  { value: 'Sora (OpenAI)', score: 9.0 },
  { value: 'Runway Gen-3 Alpha', score: 8.5 },
  { value: 'Kling 2.0', score: 8.0 },
  { value: 'HunyuanVideo', score: 8.0 },
  { value: 'Wan2.1 (Alibaba)', score: 8.0 },
  { value: 'Imagen 4 (Google)', score: 8.5 },
  { value: 'FLUX.1 (Black Forest Labs)', score: 8.5 },
  { value: 'Stable Diffusion 3.5', score: 8.0 },
  { value: 'Midjourney v7', score: 8.0 },
  { value: 'DALL-E 4', score: 8.0 },
  { value: 'Firefly 4 (Adobe)', score: 7.5 },

  // ===== 音声生成 =====
  { value: 'ElevenLabs v3', score: 8.5 },
  { value: 'OpenAI TTS (gpt-4o-audio)', score: 8.5 },
  { value: 'Suno v4', score: 8.0 },
  { value: 'Udio v2', score: 7.5 },
  { value: 'Lyria 2 (Google DeepMind)', score: 8.0 },
  { value: 'Whisper v3 large turbo', score: 8.5 },
  { value: 'Gemini 2.5 Flash TTS', score: 8.0 },

  // ===== AIエージェント・フレームワーク =====
  { value: 'Model Context Protocol (MCP)', score: 9.5 },
  { value: 'LangGraph', score: 9.0 },
  { value: 'LangChain v0.3', score: 8.5 },
  { value: 'CrewAI', score: 8.5 },
  { value: 'AutoGen v0.4', score: 8.5 },
  { value: 'Mastra', score: 8.5 },
  { value: 'PydanticAI', score: 8.5 },
  { value: 'Semantic Kernel v1', score: 8.0 },
  { value: 'Bee Agent Framework (IBM)', score: 7.5 },
  { value: 'OpenAI Agents SDK', score: 9.0 },
  { value: 'Google ADK (Agent Development Kit)', score: 9.0 },
  { value: 'Anthropic Computer Use', score: 9.0 },
  { value: 'browser-use (Python)', score: 8.0 },
  { value: 'multi-agent orchestration', score: 9.0 },
  { value: 'tool calling (function calling)', score: 9.0 },
  { value: 'AI agent memory systems', score: 8.5 },
  { value: 'agentic loop', score: 8.5 },

  // ===== RAG・情報検索 =====
  { value: 'RAG (Retrieval-Augmented Generation)', score: 9.5 },
  { value: 'GraphRAG (Microsoft)', score: 9.0 },
  { value: 'HyDE (Hypothetical Document Embeddings)', score: 8.0 },
  { value: 'late chunking', score: 7.5 },
  { value: 'ColPali (multimodal RAG)', score: 8.0 },
  { value: 'reranking (Cohere Rerank)', score: 8.0 },
  { value: 'hybrid search (vector + BM25)', score: 8.5 },
  { value: 'Contextual Retrieval (Anthropic)', score: 8.5 },
  { value: 'RAPTOR (recursive summarization)', score: 7.5 },
  { value: 'long context vs RAG', score: 8.5 },

  // ===== ベクターDB =====
  { value: 'Pinecone v3', score: 8.5 },
  { value: 'Weaviate', score: 8.0 },
  { value: 'Qdrant', score: 8.5 },
  { value: 'Milvus 2.4', score: 8.0 },
  { value: 'ChromaDB', score: 8.0 },
  { value: 'pgvector', score: 8.5 },
  { value: 'Turso (LibSQL)', score: 8.0 },
  { value: 'Supabase pgvector', score: 8.0 },

  // ===== ファインチューニング・学習技術 =====
  { value: 'LoRA (Low-Rank Adaptation)', score: 9.0 },
  { value: 'QLoRA', score: 8.5 },
  { value: 'DoRA', score: 7.5 },
  { value: 'RLHF', score: 8.5 },
  { value: 'RLAIF', score: 8.0 },
  { value: 'DPO (Direct Preference Optimization)', score: 8.5 },
  { value: 'GRPO (Group Relative Policy Optimization)', score: 8.5 },
  { value: 'SFT (Supervised Fine-Tuning)', score: 8.0 },
  { value: 'synthetic data generation', score: 9.0 },
  { value: 'knowledge distillation', score: 8.0 },
  { value: 'speculative decoding', score: 8.5 },
  { value: 'GQA (Grouped-Query Attention)', score: 8.0 },
  { value: 'Flash Attention 3', score: 8.5 },
  { value: 'MoE (Mixture of Experts)', score: 9.0 },
  { value: 'BitNet b1.58 (1-bit LLM)', score: 8.5 },
  { value: 'context window extension (1M+ tokens)', score: 9.0 },

  // ===== LLMインフラ・サービング =====
  { value: 'vLLM', score: 9.0 },
  { value: 'TGI (Text Generation Inference)', score: 8.5 },
  { value: 'Ollama', score: 9.0 },
  { value: 'llama.cpp', score: 8.5 },
  { value: 'LMDeploy', score: 8.0 },
  { value: 'TensorRT-LLM (NVIDIA)', score: 8.5 },
  { value: 'SGLang', score: 8.5 },
  { value: 'OpenRouter', score: 8.5 },
  { value: 'Together AI', score: 8.0 },
  { value: 'Fireworks AI', score: 8.0 },
  { value: 'Groq LPU inference', score: 8.5 },
  { value: 'Cerebras inference', score: 8.0 },
  { value: 'Amazon Nova (Bedrock)', score: 8.5 },
  { value: 'Google Vertex AI Gemini', score: 8.5 },
  { value: 'Azure AI Foundry', score: 8.0 },

  // ===== AI開発ツール・SDK =====
  { value: 'Vercel AI SDK', score: 9.0 },
  { value: 'LlamaIndex v0.12', score: 8.5 },
  { value: 'DSPy', score: 8.5 },
  { value: 'Instructor (structured output)', score: 8.5 },
  { value: 'Outlines (structured generation)', score: 8.0 },
  { value: 'guidance (Microsoft)', score: 7.5 },
  { value: 'Tracing & Observability (LangSmith)', score: 8.5 },
  { value: 'Weave (Weights & Biases)', score: 8.0 },
  { value: 'Phoenix (Arize AI)', score: 8.0 },
  { value: 'Braintrust', score: 7.5 },

  // ===== ハードウェア =====
  { value: 'NVIDIA Blackwell B200', score: 9.0 },
  { value: 'NVIDIA GB200 NVL72', score: 8.5 },
  { value: 'NVIDIA H200 SXM', score: 8.5 },
  { value: 'AMD MI300X', score: 8.5 },
  { value: 'Google TPU v6 (Trillium)', score: 8.5 },
  { value: 'AWS Trainium 2', score: 8.0 },
  { value: 'Groq LPU', score: 8.5 },
  { value: 'on-device AI (NPU)', score: 8.5 },
  { value: 'Apple M4 Neural Engine', score: 8.0 },
  { value: 'Snapdragon X Elite NPU', score: 7.5 },

  // ===== ベンチマーク =====
  { value: 'MMLU-Pro', score: 8.5 },
  { value: 'GPQA Diamond', score: 8.5 },
  { value: 'SWE-bench Verified', score: 9.0 },
  { value: 'LiveCodeBench', score: 8.5 },
  { value: 'HumanEval+', score: 8.0 },
  { value: 'AIME 2024/2025', score: 8.5 },
  { value: 'MATH-500', score: 8.0 },
  { value: 'Chatbot Arena (LMSYS)', score: 8.5 },
  { value: 'Frontier Math benchmark', score: 8.0 },
  { value: 'SimpleQA (OpenAI)', score: 7.5 },
  { value: 'TAU-bench (tool use)', score: 8.0 },

  // ===== ガバナンス・安全 =====
  { value: 'AI Safety (OpenAI Preparedness)', score: 8.5 },
  { value: 'Constitutional AI (Anthropic)', score: 8.5 },
  { value: 'EU AI Act', score: 8.5 },
  { value: 'AI watermarking (C2PA)', score: 8.0 },
  { value: 'prompt injection attacks', score: 8.5 },
  { value: 'jailbreak mitigation', score: 8.0 },
  { value: 'hallucination reduction', score: 9.0 },
  { value: 'mechanistic interpretability', score: 8.5 },
  { value: 'Llama Guard 3', score: 8.0 },
  { value: 'alignment faking', score: 8.0 },
  { value: 'frontier model evaluation', score: 8.5 },

  // ===== 企業・プロダクト =====
  { value: 'OpenAI ChatGPT', score: 9.5 },
  { value: 'Anthropic Claude.ai', score: 9.0 },
  { value: 'Google AI Studio', score: 9.0 },
  { value: 'Google NotebookLM', score: 8.5 },
  { value: 'Microsoft Copilot', score: 8.5 },
  { value: 'Perplexity Pro', score: 8.5 },
  { value: 'Character.AI', score: 7.5 },
  { value: 'Poe (Quora)', score: 7.5 },
  { value: 'Mistral Le Chat', score: 8.0 },
  { value: 'xAI Grok', score: 8.5 },
  { value: 'Cohere for Enterprise', score: 7.5 },
  { value: 'Harvey (legal AI)', score: 7.5 },
  { value: 'Glean (enterprise search AI)', score: 7.5 },
  { value: 'Notion AI', score: 7.5 },
  { value: 'Replit AI', score: 7.5 },

  // ===== 研究トレンド =====
  { value: 'scaling laws (LLM)', score: 9.0 },
  { value: 'emergent abilities in LLMs', score: 8.5 },
  { value: 'in-context learning', score: 8.5 },
  { value: 'prompt engineering techniques', score: 8.5 },
  { value: 'few-shot learning', score: 8.0 },
  { value: 'zero-shot chain-of-thought', score: 8.0 },
  { value: 'LLM as judge (evaluation)', score: 9.0 },
  { value: 'world model (AI)', score: 8.5 },
  { value: 'AI for science (AlphaFold 3)', score: 8.5 },
  { value: 'robotics foundation model', score: 8.0 },
  { value: 'video understanding AI', score: 8.0 },
  { value: 'diffusion transformer (DiT)', score: 8.5 },
  { value: 'state space model (Mamba 2)', score: 8.5 },
];

async function insertSeeds() {
  console.log(`🌱 ${seeds.length}個の精選シードキーワードをTursoDB(v2)に登録中...`);
  let added = 0;
  let skipped = 0;

  for (const seed of seeds) {
    try {
      const result = await db.insert(sources).values({
        type: 'keyword',
        value: seed.value,
        status: 'active',
        score: seed.score,
      }).onConflictDoNothing();
      added++;
    } catch (e: any) {
      skipped++;
    }
  }

  console.log(`✅ 完了: ${added}個追加, ${skipped}個スキップ（重複）`);

  // 現在の合計確認
  const all = await db.select().from(sources);
  console.log(`📊 DB内の合計シード数: ${all.length}個`);
}

insertSeeds().catch(console.error);
