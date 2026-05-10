import db from "../src/core/db";

const techSeeds = [
  // AI Models & Companies
  "OpenAI o3", "OpenAI o1-preview", "GPT-4o", "Claude 3.5 Sonnet", "Claude 3.5 Haiku", "Gemini 1.5 Pro", "Gemini 1.5 Flash", "Llama 3.1", "Llama 3.2", "Mistral Large 2", "DeepSeek-V3", "DeepSeek-R1", "Grok-2", "Command R+", "Qwen 2.5", "Phi-3.5", "Falcon 2", "Stable Diffusion 3", "Flux.1", "Runway Gen-3", "Luma Dream Machine", "Sora OpenAI",
  
  // AI Agent & Frameworks
  "Mastra AI", "PydanticAI", "LangGraph", "LangChain", "LlamaIndex", "CrewAI", "AutoGPT", "BabyAGI", "Microsoft AutoGen", "OpenAI Swarm", "Multi-agent Systems", "Autonomous Agents", "Agentic Workflow", "Function Calling", "Tool Use LLM", "MCP (Model Context Protocol)", "Claude Code", "Cline (prev Devins)", "Aider", "Cursor AI", "Windsurf IDE",
  
  // Infrastructure & Databases
  "Vector Database", "Pinecone", "Milvus", "Weaviate", "ChromaDB", "Qdrant", "PGVector", "Turso", "Cloudflare D1", "Edge Computing", "Serverless AI", "GPU Orchestration", "vLLM", "TGI (Text Generation Inference)", "Ollama", "Local LLM", "Quantization", "GGUF", "AWQ", "EXL2", "Flash Attention", "NVIDIA H100", "NVIDIA Blackwell", "Apple Intelligence",
  
  // Web Development & Trends
  "Next.js 15", "React 19", "Vite", "Bun 1.2", "Deno 2", "Hono", "Biome JS", "TanStack Query", "Tailwind CSS v4", "shadcn/ui", "WebAssembly (Wasm)", "Rust for JS tools", "Zod", "TypeScript 5.7", "Server Actions", "PPR (Partial Prerendering)", "WebContainer", "tRPC", "Prismic", "Sanity.io",
  
  // DevOps & Security
  "Platform Engineering", "DevSecOps", "eBPF", "OpenTelemetry", "Drizzle ORM", "Prisma", "Kueue", "Ray.io", "Kubernetes AI", "ArgoCD", "Terraform", "OpenTofu", "Pulumi", "AI Security", "Prompt Injection Defense", "LLM Guardrails", "Deepfake Detection", "Privacy-preserving ML",
  
  // Emerging Tech & Research
  "Quantum Computing", "Neuromorphic Computing", "Neuro-symbolic AI", "State Space Models (SSM)", "Mamba architecture", "Liquid Neural Networks", "Sparse Transformers", "Retrieval Augmented Generation (RAG)", "GraphRAG", "Agentic RAG", "Long Context Window", "Reasoning Models", "CoT (Chain of Thought)", "Tree of Thoughts", "Speculative Decoding",
  
  // AI Tools & Platforms
  "Hugging Face", "Replicate", "Weights & Biases", "LangSmith", "Argilla", "Weights & Biases", "Vercel AI SDK", "Together AI", "Groq (LPU)", "Anyscale", "Modal.com", "Railway.app", "Neon DB", "Supabase AI", "Appwrite", "Firebase Genkit",
  
  // Open Source & Communities
  "Stability AI", "Together AI", "EleutherAI", "LAION", "Open-source LLM", "PyTorch", "JAX", "TensorFlow", "Keras", "Scikit-learn", "Pandas", "NumPy", "Polars", "DuckDB",
  
  // Specific Topics
  "AI for Code", "AI for Design", "AI for Video", "AI for Music", "AI for Biotech", "AI for Robotics", "Humanoid Robots", "Tesla Optimus", "Figure AI", "Boston Dynamics", "Soft Robotics", "Brain-Computer Interface", "Neuralink",
  
  // Additional Keywords to reach ~200
  "Self-evolving AI", "Constitutional AI", "RLHF", "DPO (Direct Preference Optimization)", "ORPO", "LoRA", "QLoRA", "Fine-tuning", "Prompt Engineering", "Semantic Search", "Zero-shot Learning", "Few-shot Learning", "In-context Learning", "Multi-modal AI", "Vision Transformer (ViT)", "Whisper OpenAI", "Text-to-Speech (TTS)", "Speech-to-Text (STT)", "Real-time AI", "Edge AI", "IoT AI", "Smart Home AI", "AI Ethics", "AI Regulation", "EU AI Act", "Responsible AI", "Explainable AI (XAI)", "Synthetic Data", "Data Flywheel", "Scaling Laws", "Compute Optimal", "MoE (Mixture of Experts)", "Switch Transformer", "GShard", "DeepSpeed", "Megatron-LM", "BitNet", "1-bit LLM", "Triton (OpenAI)", "XLA", "CUDA", "ROCm", "Metal Performance Shaders", "CoreML", "WebNN", "ONNX"
];

function seedExpansion() {
  console.log("--- Expanding Seeds to 200 (Latest Tech Trends) ---");
  const insert = db.prepare('INSERT OR IGNORE INTO sources (type, value, status, score) VALUES (?, ?, ?, ?)');
  
  let count = 0;
  db.transaction(() => {
    for (const kw of techSeeds) {
      const result = insert.run('keyword', kw, 'active', 10.0);
      if (result.changes > 0) count++;
    }
  })();

  console.log(`Successfully added ${count} new unique seeds to the database.`);
  const total = db.prepare('SELECT COUNT(*) as count FROM sources').get() as any;
  console.log(`Total seed count in DB: ${total.count}`);
}

seedExpansion();
