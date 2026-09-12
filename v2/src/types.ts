export interface CollectedItem {
  id: number;
  title: string | null;
  titleJa?: string | null;
  url: string | null;
  summary: string | null;
  category: string | null;
  isFavorited: number | null;
  isReadLater: number | null;
  isRead: number | null;
  importanceScore: number | null;
  normalizedImportanceScore?: number | null;
  tags: string[] | null;
  publishedAt: string | null;
  createdAt: string;
  sourceValue: string | null;
  sourceType: string | null;
  storyId?: number | null;
  storyCount?: number | null;
  storyOutlets?: string[];
  /** 抽出本文を持っているか。本文そのものは公開面に出さない（第三条）ので有無だけを渡す。 */
  hasBody?: boolean;
  /** 本文抽出の失敗タグ（robots_disallow / http_404 等）。要約が無い理由の出し分けに使う。 */
  extractError?: string | null;
}

export interface Source {
  id: number;
  type: string;
  value: string;
  status: string;
  score: number | null;
  lastHitAt: string | null;
}

export interface Report {
  id: number;
  type: string;
  content: string | null;
  reportDate: string;
  createdAt: string | null;
}

export interface SourcePerformance extends Source {
  collectedCount: number;
}

export interface SourceROI extends Source {
  collectedCount: number;
  avgImportance: number;
  adoptedCount: number;
  favoritedCount: number;
  readLaterCount: number;
  adoptionRate: number;   // 採用率(%)
  contribution: number;   // 貢献度(採用×3+お気に入り×2+後で読む×1)
  roi: number;            // 後方互換（=contribution）
}

export interface PipelineLog {
  id: number;
  date: string;
  collected: number;
  failed: number;
  durationMs: number;
  createdAt: string | null;
}

export interface TrendingKeyword {
  keyword: string;
  thisWeek: number;
  lastWeek: number;
  delta: number;
}

export interface Claim {
  id: number;
  articleId: number | null;
  subject: string;
  predicate: string;
  value: string;
  confidence: string | null;
  createdAt: string | null;
  articleTitle?: string | null;
}

export interface ConflictingClaim {
  subject: string;
  predicate: string;
  claims: Claim[];
}

export interface UserTopicWeight {
  keyword: string;
  weight: number;
}

// v3知識グラフ
export interface BenchmarkEntry {
  entityName: string;
  score: number;
  unit: string | null;
  recordedDate: string | null;
  sourceUrl: string | null;
  confidence: string | null;
  trend: 'up' | 'down' | 'flat' | 'new';
}

export interface BenchmarkLeaderboard {
  benchmarkName: string;
  unit: string | null;
  entries: BenchmarkEntry[];
  series: Record<string, number | string>[]; // チャート用: {date, [entity]: score}
  topEntities: string[];
}

export interface KnowledgeRelation {
  id: number;
  subjectName: string;
  relationType: string;
  objectName: string;
  confidence: string | null;
  status: string | null;
  validFrom: string | null;
}

export interface BenchmarkAlert {
  benchmarkName: string;
  newLeader: string;
  prevLeader: string;
  newScore: number;
  prevScore: number;
  date: string | null;
}

export interface KnowledgeStats {
  entities: number;
  benchmarks: number;
  relations: number;
  staleRelations: number;
}

// v3自律リサーチ
export interface BriefingReport {
  id: number;
  content: string | null;
  reportDate: string;
  createdAt: string | null;
}

export interface AlertItem {
  id: number;
  type: string;
  title: string;
  reason: string;
  entityName: string | null;
  severity: string | null;
  relatedArticleId: number | null;
  createdAt: string | null;
}

export interface ResearchBrief {
  topic: string;
  content: string;
  relatedArticles: { title: string; url: string | null }[];
}

// v3.2 ベクトル活用: 今週の話題の塊（複数記事が報じたトピック）
export interface TopicCluster {
  storyId: number;
  headline: string;
  size: number;
  category: string | null;
  importance: number;
  members: { id: number; title: string; url: string | null }[];
}

export type ToastType = 'success' | 'error' | 'info';
