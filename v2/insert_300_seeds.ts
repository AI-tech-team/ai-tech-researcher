import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from './src/db/index';
import { sources, collectedData, reports, adoptionLogs } from './src/db/schema';

const keywords = [
  // 1. 基盤モデル・LLM (Foundational Models)
  "GPT-5", "GPT-5 Turbo", "GPT-5 Omni", "Claude 4", "Claude 4 Opus", "Claude 4.5 Sonnet", "Claude 4.5 Haiku", 
  "Gemini 3.0 Pro", "Gemini 3.0 Ultra", "Gemini 3.1 Flash", "Gemini 3.1 Flash Lite", "Llama 4", "Llama 4 400B", 
  "Llama 4 1T", "Llama 4 Vision", "Grok 3", "Mistral 2 Large", "Mistral 2 Medium", "Qwen 3", "Qwen 3 Max", 
  "Yi-34B", "Command R++", "Jamba 2", "Mamba-3 architecture", "Liquid Neural Networks 2026", "Inflection-3", 
  "Pi 2", "DBRX 2", "Phi-4", "Gemma 3", "Command R v2", "InternLM 3", "DeepSeek-V3", "Mixtral 10x22B", "StarCoder 3",
  "CodeLlama 2", "WizardLM 3", "Vicuna v2", "Zephyr-8B", "OpenHermes 3", "Orca 3", "Nemotron-5", "Falcon 180B v2",
  "Xverse-2", "Baichuan 4", "ChatGLM 4", "SenseNova 5", "Minimax", "Moonshot AI", "StepFun",
  
  // 2. マルチモーダル・生成AI (Vision, Audio, Video)
  "Sora 2.0", "Sora API", "Midjourney v7", "Midjourney v8 alpha", "Stable Diffusion 4", "SDXL 2.0", "Runway Gen-4", 
  "Pika 2.0", "V-JEPA 2", "I-JEPA 2", "AudioLM 2", "MusicGen 2", "Suno v4", "Udio v2", "HeyGen 3.0", "Synthesia 3.0", 
  "Emu 3", "Flamingo 2", "LLaVA 2.0", "Qwen-VL 2", "BLIP-3", "CogVLM 2", "Kosmos-3", "ImageBind 2", "VideoPoet 2",
  "Lumiere v2", "AnimateDiff v2", "ControlNet 2.0", "LoRA for Video", "Voice Engine 2", "ElevenLabs v3", "Bark v2",
  "VALL-E 2", "SeamlessM4T v2", "Whisper v4", "Canva Magic Studio 2026", "Adobe Firefly Video Model", "DALL-E 4",
  "Nuwa-XL", "Make-A-Video 2", "AudioLDM 2", "Stable Audio 2", "SVD (Stable Video Diffusion) 2",
  
  // 3. アーキテクチャ・推論・学習手法 (Techniques & Architecture)
  "Mixture of Experts (MoE)", "Sparse MoE", "Continuous Batching", "PagedAttention v2", "FlashAttention-3", 
  "Ring Attention", "Long Context Window (10M+ tokens)", "RAG 2.0", "Graph RAG", "Active RAG", "Multi-agent RAG", 
  "Self-RAG", "Toolformer", "Auto-GPT v2", "BabyAGI 2", "Prompt Tuning", "LoRA", "QLoRA", "DoRA", "RLHF", "DPO", 
  "KTO", "Constitutional AI", "Knowledge Distillation", "Quantization (4-bit)", "Quantization (1.58-bit)", "BitNet", 
  "Transformer variants", "Mamba architecture", "SSM (State Space Models)", "RWKV-6", "Flow Matching", 
  "Diffusion Transformers (DiT)", "Latent Diffusion Models", "Cross-Attention", "Rotary Positional Embedding (RoPE)", 
  "ALiBi", "Speculative Decoding", "KV Cache Quantization", "Prefix Caching", "Medusa Decoding", "Lookahead Decoding",
  "Data Pruning", "Synthetic Data Generation", "Self-Play Fine-Tuning", "Constitutional AI", "Reward Models",
  "Instruction Tuning", "Chain-of-Thought (CoT)", "Tree-of-Thoughts (ToT)", "Graph-of-Thoughts (GoT)", "ReAct",
  
  // 4. フレームワーク・ライブラリ (Frameworks & Dev Tools)
  "LangChain v2", "LlamaIndex v2", "AutoGen v2", "CrewAI", "Semantic Kernel", "guidance", "Outlines", "DSPy", 
  "vLLM", "TensorRT-LLM", "TGI (Text Generation Inference)", "LMDeploy", "Ollama", "llama.cpp", "Whisper.cpp", 
  "MLX", "PyTorch 2.5", "JAX", "TensorFlow 2.16", "Hugging Face Transformers", "Peft", "TRL", "Ray Serve", "BentoML", 
  "Gradio 4.0", "Streamlit", "Vercel AI SDK", "OpenAI SDK", "Anthropic SDK", "Google GenAI SDK", "LangSmith",
  "Phoenix (Arize)", "Weaviate", "Pinecone", "Milvus", "Qdrant", "ChromaDB", "pgvector", "RedisStack", "Neon Serverless",
  "Supabase pgvector", "Mellon", "Weights & Biases", "ClearML", "MLflow 3", "Kubeflow", "Triton Inference Server",
  
  // 5. ハードウェア・インフラ (Hardware & Infrastructure)
  "NVIDIA B200", "NVIDIA B100", "NVIDIA H200", "AMD MI300X", "AMD MI400", "Google TPU v6", "AWS Trainium 2", 
  "AWS Inferentia 3", "Azure Maia", "Intel Gaudi 3", "Cerebras CS-3", "Groq LPU", "Tenstorrent", "AI PC", "NPU", 
  "Snapdragon X Elite", "Apple M4", "Apple A18 Pro", "HBM3e (High Bandwidth Memory)", "HBM4", "Silicon Photonics", 
  "Liquid Cooling Data Centers", "Edge AI", "NVIDIA GB200 Grace Blackwell Superchip", "NVLink 5", "InfiniBand NDR",
  "Ethernet for AI (UEC)", "PCIe Gen 6", "TSMC 2nm", "TSMC 3nm", "Chiplet Architecture", "Advanced Packaging (CoWoS)",
  "Neuromorphic Computing", "Quantum AI", "FPGA for AI", "RISC-V AI Accelerators", "On-device AI", "Local LLMs",
  
  // 6. 応用分野・エージェント (Applications & AI Agents)
  "AI Coding Assistants", "GitHub Copilot X", "Cursor IDE", "Devin (AI Software Engineer)", "SWE-agent", "OpenDevin", 
  "AI Search", "Perplexity Pro", "Google AI Overviews", "Arc Browser", "AI Agents", "Autonomous Web Browsing", 
  "AI Customer Support", "AI Legal Tech", "AI MedTech", "AlphaFold 3", "AI Drug Discovery", "AI Robotics", 
  "Figure 02", "Tesla Optimus Gen 3", "Boston Dynamics Atlas (Electric)", "AI NPCs in Gaming", "AI Education Tutors",
  "AI Video Editors", "AI Music Producers", "AI Voice Cloning", "Real-time Translation", "AI companions", "Character.AI",
  "Enterprise AI Search", "Glean", "Microsoft 365 Copilot", "Google Workspace Duet AI", "Salesforce Einstein",
  "ServiceNow NowAssist", "Notion AI", "Jasper AI", "Copy.ai", "Harvey (Legal AI)", "BloombergGPT", "FinGPT",
  
  // 7. ガバナンス・倫理・セキュリティ (Governance, Ethics & Security)
  "AGI (Artificial General Intelligence)", "ASI (Artificial Superintelligence)", "AI Alignment", "AI Safety", 
  "EU AI Act", "NIST AI RMF", "Copyright & AI", "Data Scraping Lawsuits", "Data Contamination", "Model Collapse", 
  "Hallucination Mitigation", "Red Teaming", "Watermarking AI content", "Deepfake Detection", "Open Source vs Closed Source", 
  "Compute Governance", "Sovereign AI", "AI Auditing", "Explainable AI (XAI)", "Mechanistic Interpretability",
  "Prompt Injection", "Jailbreaking LLMs", "Data Privacy in AI", "Federated Learning", "Differential Privacy",
  "AI Bias and Fairness", "Algorithmic Transparency", "Open Weights Models", "AI Open Source Definition (OSI)",
  "Safety Guardrails", "Llama Guard 2", "NeMo Guardrails", "AI generated content disclosure", "Deepfake regulation",
  
  // 8. ベンチマーク・評価指標 (Benchmarks & Evaluation)
  "MMLU", "MMLU-Pro", "GPQA", "HumanEval", "MBPP", "GSM8K", "MATH benchmark", "Chatbot Arena", "LMSYS", 
  "AlpacaEval", "MT-Bench", "SWE-bench", "AgentBench", "WebArena", "VQA (Visual Question Answering)", "MMMU",
  "BLEU", "ROUGE", "METEOR", "Perplexity", "Elo Rating for LLMs", "AI Index Report 2026", "State of AI Report",
  "Hugging Face Open LLM Leaderboard", "Vellm Leaderboard", "Trustworthy AI benchmarks",
  
  // 9. クラウドサービス・プラットフォーム (Cloud & Platforms)
  "Azure OpenAI Service", "Google Vertex AI", "AWS Bedrock", "Hugging Face Inference Endpoints", "Together AI",
  "Fireworks AI", "Anyscale Endpoints", "Replicate", "Baseten", "Modal", "RunPod", "Lambda Labs", "CoreWeave",
  "Scale AI", "Snorkel AI", "Labelbox", "Roboflow", "Databricks MosaicML", "Snowflake Cortex",
  
  // 10. AIスタートアップ・企業 (Companies & Ecosystem)
  "OpenAI", "Anthropic", "Google DeepMind", "Meta AI", "Mistral AI", "Cohere", "Inflection AI", "Adept AI",
  "xAI", "Perplexity AI", "Midjourney", "Runway", "Pika Labs", "Stability AI", "Hugging Face", "NVIDIA", "AMD",
  "Cerebras", "Groq", "Sakana AI", "Preferred Networks", "Elyza", "Rinna", "Karakuri", "Turing", "Baidu (Ernie)",
  "Alibaba (Qwen)", "Tencent (Hunyuan)", "ByteDance (Doubao)"
];

async function insert300Seeds() {
  console.log("🧹 依存関係順に全テーブルをクリアしています...");
  await db.delete(adoptionLogs);
  await db.delete(reports);
  await db.delete(collectedData);
  await db.delete(sources);

  console.log(`🌱 2026年最新のシードキーワード（${keywords.length}個）を登録しています...`);
  let count = 0;
  for (const kw of keywords) {
    try {
      await db.insert(sources).values({
        type: 'keyword',
        value: kw,
        status: 'active',
        score: Math.floor(Math.random() * 5) + 5.0, // 5.0〜10.0のランダムスコア
      }).onConflictDoNothing();
      count++;
    } catch (e) {
      // 
    }
  }
  console.log(`✅ 成功: ${count}個の最新シードキーワードを登録完了しました！`);
}

insert300Seeds().catch(console.error);
