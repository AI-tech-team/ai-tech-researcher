// ナレッジエンジン: DB・コーパスと接続したAI。
// タスク文字列を渡すだけで、必要なデータはエージェントが自分でツール経由で取りに行く。
// パイプライン・チャット・APIルートから共通利用できる。
import { google } from '@ai-sdk/google';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { db, client } from '@/db';
import {
  collectedData, entities, claims, benchmarks, relations,
  alerts, reports, researchQuestions, readingEvents,
} from '@/db/schema';
import { eq, desc, gte, and, count, sql, lt } from 'drizzle-orm';
import { hybridSearch } from '@/lib/retrieval';

export type KnowledgeAIModel = 'gemini-2.5-flash-lite' | 'gemini-2.5-flash';

export interface KnowledgeAIOptions {
  maxSteps?: number;
  model?: KnowledgeAIModel;
  systemSuffix?: string; // 出力フォーマット等の追加指示
}

function buildTools() {
  return {
    get_recent_articles: tool({
      description: '直近の収集記事を重要度・期間でフィルタして取得する',
      inputSchema: z.object({
        days: z.number().int().min(1).max(30).default(2),
        limit: z.number().int().min(1).max(50).default(20),
        minImportance: z.number().int().min(1).max(10).default(6),
      }),
      execute: async ({ days, limit, minImportance }) => {
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
        const rows = await db.select({
          id: collectedData.id, titleJa: collectedData.titleJa, title: collectedData.title,
          category: collectedData.category, importanceScore: collectedData.importanceScore,
          summary: collectedData.summary, url: collectedData.url,
          publishedAt: collectedData.publishedAt, storyCount: collectedData.storyCount,
        }).from(collectedData)
          .where(and(gte(collectedData.createdAt, since), gte(collectedData.importanceScore, minImportance)))
          .orderBy(desc(collectedData.importanceScore), desc(collectedData.createdAt))
          .limit(limit);
        if (rows.length === 0) return 'データなし';
        return rows.map(r => {
          const corrob = (r.storyCount ?? 1) > 1 ? `(${r.storyCount}媒体)` : '';
          return `[ID:${r.id}][重要度${r.importanceScore}/${r.category ?? '?'}]${corrob} ${r.titleJa || r.title}\n  ${(r.summary ?? '').slice(0, 150)}\n  URL: ${r.url ?? ''}`;
        }).join('\n');
      },
    }),

    search_corpus: tool({
      description: '収集コーパスをキーワード・自然文でハイブリッド検索する',
      inputSchema: z.object({
        query: z.string().max(200),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ query, limit }) => {
        const docs = await hybridSearch(query, limit);
        if (docs.length === 0) return `「${query}」: 該当なし`;
        return docs.map(d =>
          `[ID:${d.id}][重要度${d.importance}] ${d.titleJa || d.title}\n  ${(d.summary ?? '').slice(0, 150)}`
        ).join('\n');
      },
    }),

    get_entity_status: tool({
      description: '特定エンティティの知識グラフ状態（ベンチマーク・クレーム・関係）を取得する',
      inputSchema: z.object({ entityName: z.string().max(80) }),
      execute: async ({ entityName }) => {
        const key = entityName.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
        const ent = await db.select().from(entities)
          .where(eq(entities.normalizedKey, key)).limit(1).then(r => r[0] ?? null);
        if (!ent) return `「${entityName}」は知識グラフ未登録`;
        const [benches, clms, rels] = await Promise.all([
          db.select({ b: benchmarks.benchmarkName, s: benchmarks.score, d: benchmarks.recordedDate })
            .from(benchmarks).where(eq(benchmarks.entityId, ent.id))
            .orderBy(desc(benchmarks.recordedDate)).limit(5),
          db.select({ p: claims.predicate, v: claims.value, cs: claims.confidenceScore, d: claims.validFrom })
            .from(claims).where(and(eq(claims.entityId, ent.id), eq(claims.status, 'active')))
            .orderBy(desc(claims.validFrom)).limit(6),
          db.select({ t: relations.relationType, o: relations.objectName })
            .from(relations)
            .where(and(eq(relations.subjectEntityId, ent.id), eq(relations.status, 'active'))).limit(5),
        ]);
        let out = `■ ${ent.canonicalName} (${ent.type ?? 'model'}) | 言及${ent.mentionCount}回`;
        for (const b of benches) out += `\n  [bench] ${b.b}: ${b.s} (${b.d ?? '?'})`;
        for (const c of clms) out += `\n  [claim] ${c.p}: ${c.v} (確信度${Number(c.cs ?? 0.7).toFixed(2)})`;
        for (const r of rels) out += `\n  [rel] ${r.t} → ${r.o}`;
        return out;
      },
    }),

    get_knowledge_graph_summary: tool({
      description: '知識グラフ全体の統計（エンティティ・クレーム健全度・注目エンティティ・最近の関係変化）を取得する',
      inputSchema: z.object({}),
      execute: async () => {
        const [entCount, claimStats, topEnts, recentRels, recentBenches] = await Promise.all([
          db.select({ c: count() }).from(entities),
          client.execute({
            sql: `SELECT COUNT(*) as total, AVG(COALESCE(confidence_score,0.7)) as avg_conf,
                         SUM(CASE WHEN COALESCE(confidence_score,0.7)>=0.7 THEN 1 ELSE 0 END) as healthy,
                         SUM(CASE WHEN status='stale' THEN 1 ELSE 0 END) as stale
                  FROM claims`,
            args: [],
          }),
          db.select({ name: entities.canonicalName, m: entities.mentionCount })
            .from(entities).orderBy(desc(entities.mentionCount)).limit(8),
          db.select({ s: relations.subjectName, t: relations.relationType, o: relations.objectName })
            .from(relations).where(eq(relations.status, 'active'))
            .orderBy(desc(relations.validFrom)).limit(6),
          db.select({ e: benchmarks.entityName, b: benchmarks.benchmarkName, s: benchmarks.score, d: benchmarks.recordedDate })
            .from(benchmarks).orderBy(desc(benchmarks.recordedDate)).limit(8),
        ]);
        const cs = claimStats.rows[0] as any;
        let out = `エンティティ: ${entCount[0].c}個`;
        out += `\nクレーム: total=${cs.total} healthy=${cs.healthy} stale=${cs.stale} avg_conf=${Number(cs.avg_conf).toFixed(2)}`;
        out += `\n注目エンティティ: ${topEnts.map(e => `${e.name}(×${e.m})`).join(', ')}`;
        out += `\n最近の関係: ${recentRels.map(r => `${r.s} ${r.t} ${r.o}`).join(' / ')}`;
        out += `\n最新ベンチ: ${recentBenches.map(b => `${b.e}/${b.b}:${b.s}(${b.d ?? '?'})`).join(', ')}`;
        return out;
      },
    }),

    get_statistics: tool({
      description: '収集統計（記事数・カテゴリ分布・前期比トレンド）を取得する',
      inputSchema: z.object({ days: z.number().int().min(1).max(30).default(7) }),
      execute: async ({ days }) => {
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
        const prevSince = new Date(Date.now() - days * 2 * 86_400_000).toISOString();
        const [catNow, catPrev, total] = await Promise.all([
          db.select({ cat: collectedData.category, c: count() })
            .from(collectedData).where(gte(collectedData.createdAt, since))
            .groupBy(collectedData.category).orderBy(desc(count())),
          db.select({ cat: collectedData.category, c: count() })
            .from(collectedData).where(and(gte(collectedData.createdAt, prevSince), lt(collectedData.createdAt, since)))
            .groupBy(collectedData.category),
          db.select({ c: count() }).from(collectedData).where(gte(collectedData.createdAt, since)),
        ]);
        const prev = new Map(catPrev.map(r => [r.cat, Number(r.c)]));
        const lines = catNow.map(r => {
          const p = prev.get(r.cat) ?? 0;
          const diff = Number(r.c) - p;
          const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
          return `${r.cat ?? '未分類'}: ${r.c}件 ${arrow}(${diff > 0 ? '+' : ''}${diff})`;
        });
        return `直近${days}日: 計${total[0].c}件\n${lines.join('\n')}`;
      },
    }),

    get_alerts: tool({
      description: 'アクティブなアラート（ベンチ首位交代・競合変化・急増）を取得する',
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(8) }),
      execute: async ({ limit }) => {
        const rows = await db.select({
          title: alerts.title, reason: alerts.reason, severity: alerts.severity, type: alerts.type,
        }).from(alerts).where(eq(alerts.status, 'active'))
          .orderBy(desc(alerts.createdAt)).limit(limit);
        return rows.map(a => `[${a.severity ?? 'watch'}/${a.type}] ${a.title}\n  ${a.reason}`).join('\n') || 'なし';
      },
    }),

    get_previous_report: tool({
      description: '直前のレポートを取得する（変化点比較・流れの継続用）',
      inputSchema: z.object({
        type: z.enum(['daily', 'weekly', 'monthly', 'briefing', 'cross_insight', 'corpus_health']),
        maxChars: z.number().int().min(100).max(2000).default(800),
      }),
      execute: async ({ type, maxChars }) => {
        const row = await db.select({ content: reports.content, reportDate: reports.reportDate })
          .from(reports).where(eq(reports.type, type))
          .orderBy(desc(reports.createdAt)).limit(1).then(r => r[0] ?? null);
        if (!row) return `前回の${type}レポートなし`;
        return `前回(${row.reportDate}):\n${(row.content ?? '').slice(0, maxChars)}`;
      },
    }),

    get_research_findings: tool({
      description: '直近の夜間自律リサーチの調査結果を取得する',
      inputSchema: z.object({ hours: z.number().int().min(1).max(48).default(24) }),
      execute: async ({ hours }) => {
        const since = new Date(Date.now() - hours * 3_600_000).toISOString();
        const rows = await db.select({
          question: researchQuestions.question,
          findings: researchQuestions.findings,
          findingsUrl: researchQuestions.findingsUrl,
        }).from(researchQuestions)
          .where(and(eq(researchQuestions.status, 'investigated'), gte(researchQuestions.investigatedAt, since)))
          .limit(6);
        return rows.map(r =>
          `Q: ${r.question}\n→ ${(r.findings ?? '調査結果なし').slice(0, 250)}${r.findingsUrl ? `\n  ${r.findingsUrl}` : ''}`
        ).join('\n\n') || '直近の調査結果なし';
      },
    }),

    get_reading_patterns: tool({
      description: 'ユーザーの読書行動パターン（よく読むカテゴリ・重み）を取得する。レポートのトーン調整に使う。',
      inputSchema: z.object({ days: z.number().int().min(1).max(30).default(14) }),
      execute: async ({ days }) => {
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
        const rows = await db.select({
          category: readingEvents.category,
          w: sql<number>`SUM(${readingEvents.weight})`,
        }).from(readingEvents).where(gte(readingEvents.createdAt, since))
          .groupBy(readingEvents.category)
          .orderBy(desc(sql`SUM(${readingEvents.weight})`)).limit(5);
        if (rows.length === 0) return 'データなし';
        return rows.map(r => `${r.category ?? '未分類'}: 重み${Number(r.w).toFixed(1)}`).join('\n');
      },
    }),
  };
}

const BASE_SYSTEM = `あなたはAI Tech Researcherのナレッジエンジンです。
ツールを使ってデータベース・コーパスを自律的に探索し、与えられたタスクを実行してください。
必要な情報はすべてツールで取得できます。情報が足りなければ追加でツールを呼んでください。
日本語で出力してください。`;

export async function askKnowledgeAI(task: string, options: KnowledgeAIOptions = {}): Promise<string> {
  const { maxSteps = 8, model = 'gemini-2.5-flash-lite', systemSuffix = '' } = options;
  const { text } = await generateText({
    model: google(model),
    stopWhen: stepCountIs(maxSteps),
    system: systemSuffix ? `${BASE_SYSTEM}\n\n${systemSuffix}` : BASE_SYSTEM,
    prompt: task,
    tools: buildTools(),
  });
  return text;
}
