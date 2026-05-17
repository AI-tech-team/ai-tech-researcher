export interface CollectedItem {
  id: number;
  title: string | null;
  url: string | null;
  summary: string | null;
  category: string | null;
  isFavorited: number | null;
  isReadLater: number | null;
  importanceScore: number | null;
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

export type ToastType = 'success' | 'error' | 'info';
