export interface CollectedItem {
  id: number;
  title: string | null;
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
  roi: number;
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

export type ToastType = 'success' | 'error' | 'info';
