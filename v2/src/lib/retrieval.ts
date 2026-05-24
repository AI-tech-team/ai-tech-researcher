// v4 フェーズ3: ハイブリッド検索（ベクトル意味検索＋FTS5全文検索をRRFで統合）。
// 自前コーパスRAGの中核。チャット・夜間リサーチが外部検索なしで答えるための土台。
import { client } from '@/db';
import { google } from '@ai-sdk/google';
import { embedMany } from 'ai';

export interface RetrievedDoc {
  id: number;
  title: string | null;
  titleJa: string | null;
  summary: string | null;
  url: string | null;
  category: string | null;
  importance: number;
  storyCount: number;
  snippet: string | null; // rawContent冒頭（あれば）
}

// クエリをFTS5(trigram)用のMATCH式に変換。trigramは3文字以上の語のみ対象。
function buildFtsMatch(query: string): string {
  const terms = query.toLowerCase().match(/[a-z0-9]{3,}|[぀-ヿ一-鿿]{3,}/gu) ?? [];
  const uniq = [...new Set(terms)].slice(0, 10);
  // 引用符で囲みOR結合（演算子誤爆を防ぐ）。内部の"はエスケープ
  return uniq.map(t => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

// ベクトル＋FTS5のハイブリッド検索。RRFで統合した上位topK件を返す。
export async function hybridSearch(query: string, topK = 8): Promise<RetrievedDoc[]> {
  const q = query.trim().slice(0, 300);
  if (!q) return [];

  // 1) ベクトル意味検索（埋め込み未生成やAPI失敗時は空）
  let vecIds: number[] = [];
  try {
    const { embeddings } = await embedMany({
      model: google.embedding('gemini-embedding-001'),
      values: [q],
      providerOptions: { google: { outputDimensionality: 768, taskType: 'SEMANTIC_SIMILARITY' } },
    });
    const vecStr = JSON.stringify(embeddings[0]);
    const r = await client.execute({
      sql: `SELECT cd.id AS id FROM vector_top_k('collected_embedding_idx', vector32(?), 30) AS v
            JOIN collected_data cd ON cd.rowid = v.id`,
      args: [vecStr],
    });
    vecIds = r.rows.map(x => Number(x.id));
  } catch (e: any) {
    console.warn('[hybridSearch] vector検索失敗:', e.message?.slice(0, 80));
  }

  // 2) FTS5全文検索（インデックス未構築やMATCH構文エラー時は空）
  let ftsIds: number[] = [];
  const match = buildFtsMatch(q);
  if (match) {
    try {
      const r = await client.execute({
        sql: `SELECT rowid AS id FROM collected_fts WHERE collected_fts MATCH ? ORDER BY rank LIMIT 30`,
        args: [match],
      });
      ftsIds = r.rows.map(x => Number(x.id));
    } catch (e: any) {
      console.warn('[hybridSearch] FTS検索失敗:', e.message?.slice(0, 80));
    }
  }

  // 3) Reciprocal Rank Fusion（K=60）
  const K = 60;
  const score = new Map<number, number>();
  vecIds.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (K + i)));
  ftsIds.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (K + i)));
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK).map(([id]) => id);
  if (ranked.length === 0) return [];

  // 4) 詳細取得（順位を保持）
  const ph = ranked.map(() => '?').join(',');
  const rows = (await client.execute({
    sql: `SELECT id, title, title_ja AS titleJa, summary, url, category,
                 importance_score AS imp, story_count AS sc, SUBSTR(raw_content, 1, 800) AS snippet
          FROM collected_data WHERE id IN (${ph})`,
    args: ranked,
  })).rows;
  const order = new Map(ranked.map((id, i) => [id, i]));
  return (rows as any[])
    .map(r => ({
      id: Number(r.id), title: r.title, titleJa: r.titleJa, summary: r.summary, url: r.url,
      category: r.category, importance: Number(r.imp ?? 5), storyCount: Number(r.sc ?? 1), snippet: r.snippet,
    }))
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}
