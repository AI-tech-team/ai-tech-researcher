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
  tags: string[] | null;
  publishedAt: string | null;
  createdAt: string;
  sourceValue: string | null;
  sourceType: string | null;
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

export type ToastType = 'success' | 'error' | 'info';
