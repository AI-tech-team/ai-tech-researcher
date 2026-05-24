// v4 フェーズ3 / v4.5: ハイブリッド検索（意味検索＋全文検索をRRFで統合）。
// 自前コーパスRAGの中核。チャット・夜間リサーチが外部検索なしで答えるための土台。
// v4.5: 記事レベル＋パッセージ(チャンク)レベルの意味検索＋FTS5全文 を統合。
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
  snippet: string | null; // 最良一致チャンク（無ければrawContent冒頭）
}

// クエリをFTS5(trigram)用のMATCH式に変換。trigramは3文字以上の語のみ対象。
function buildFtsMatch(query: string): string {
  const terms = query.toLowerCase().match(/[a-z0-9]{3,}|[぀-ヿ一-鿿]{3,}/gu) ?? [];
  const uniq = [...new Set(terms)].slice(0, 10);
  return uniq.map(t => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

// RRFスコアを加算するヘルパ
function addRrf(score: Map<number, number>, ids: number[], K = 60) {
  ids.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (K + i)));
}

// ベクトル(記事＋チャンク)＋FTS5のハイブリッド検索。RRFで統合した上位topK件を返す。
export async function hybridSearch(query: string, topK = 8): Promise<RetrievedDoc[]> {
  const q = query.trim().slice(0, 300);
  if (!q) return [];

  // クエリ埋め込み（非対称: RETRIEVAL_QUERY）
  let vecStr: string | null = null;
  try {
    const { embeddings } = await embedMany({
      model: google.embedding('gemini-embedding-001'),
      values: [q],
      providerOptions: { google: { outputDimensionality: 768, taskType: 'RETRIEVAL_QUERY' } },
    });
    vecStr = JSON.stringify(embeddings[0]);
  } catch (e: any) {
    console.warn('[hybridSearch] クエリ埋め込み失敗:', e.message?.slice(0, 80));
  }

  const score = new Map<number, number>();
  const bestChunk = new Map<number, string>(); // article_id -> 最良一致チャンク本文

  // 1) 記事レベル意味検索（title+summary）
  if (vecStr) {
    try {
      const r = await client.execute({
        sql: `SELECT cd.id AS id FROM vector_top_k('collected_embedding_idx', vector32(?), 30) AS v
              JOIN collected_data cd ON cd.rowid = v.id`,
        args: [vecStr],
      });
      addRrf(score, r.rows.map(x => Number(x.id)));
    } catch (e: any) {
      console.warn('[hybridSearch] 記事ベクトル失敗:', e.message?.slice(0, 80));
    }

    // 2) パッセージ(チャンク)レベル意味検索（本文の該当段落）
    try {
      const r = await client.execute({
        sql: `SELECT cc.article_id AS aid, cc.text AS text
              FROM vector_top_k('chunk_embedding_idx', vector32(?), 30) AS v
              JOIN content_chunks cc ON cc.rowid = v.id`,
        args: [vecStr],
      });
      const chunkOrder: number[] = [];
      for (const x of r.rows as any[]) {
        const aid = Number(x.aid);
        chunkOrder.push(aid);
        if (!bestChunk.has(aid)) bestChunk.set(aid, String(x.text ?? '').slice(0, 800)); // 上位＝最良
      }
      addRrf(score, chunkOrder);
    } catch (e: any) {
      console.warn('[hybridSearch] チャンクベクトル失敗:', e.message?.slice(0, 80));
    }
  }

  // 3) FTS5全文検索（記事レベル）
  const match = buildFtsMatch(q);
  if (match) {
    try {
      const r = await client.execute({
        sql: `SELECT rowid AS id FROM collected_fts WHERE collected_fts MATCH ? ORDER BY rank LIMIT 30`,
        args: [match],
      });
      addRrf(score, r.rows.map(x => Number(x.id)));
    } catch (e: any) {
      console.warn('[hybridSearch] FTS検索失敗:', e.message?.slice(0, 80));
    }
  }

  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK).map(([id]) => id);
  if (ranked.length === 0) return [];

  // 詳細取得（順位保持）。snippetは最良チャンク優先、無ければrawContent冒頭
  const ph = ranked.map(() => '?').join(',');
  const rows = (await client.execute({
    sql: `SELECT id, title, title_ja AS titleJa, summary, url, category,
                 importance_score AS imp, story_count AS sc, SUBSTR(raw_content, 1, 800) AS rawHead
          FROM collected_data WHERE id IN (${ph})`,
    args: ranked,
  })).rows;
  const order = new Map(ranked.map((id, i) => [id, i]));
  return (rows as any[])
    .map(r => {
      const id = Number(r.id);
      return {
        id, title: r.title, titleJa: r.titleJa, summary: r.summary, url: r.url,
        category: r.category, importance: Number(r.imp ?? 5), storyCount: Number(r.sc ?? 1),
        snippet: bestChunk.get(id) ?? (r.rawHead ?? null),
      };
    })
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}
