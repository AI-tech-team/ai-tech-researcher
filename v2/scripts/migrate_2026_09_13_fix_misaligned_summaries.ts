/**
 * 位置対応バグで**別の論文の要約が付いていた**記事を、実物のabstractから作り直す。
 *
 * 背景は docs/decisions.md の「⑩ 記事の要約が別の記事のものになっていた」。
 * 2026-09-13 04:50 UTC の収集で HF Daily Papers 6件が入り、うち4件の
 * summary / category / importance_score / ai_relevance が別論文のものだった。
 *
 * ⚠ 入れ替えでは直せない。候補8件のうち2件がゲートで落ちており、
 *   `Building Multilingual Bridges` の正しい要約は**保存されていない行**に付いていたため。
 *   だから再割り当てではなく、HF APIのabstractから作り直す。
 *
 * ⚠ 直すのは「今回ズレたと確認できた行」だけ。過去にどれだけ同じことが起きたかは
 *   測れていない（判断ログの「測定について自分の誤り」を参照）。**分からないものを
 *   分かったことにして一括で作り直さない。**
 *
 * 使い方:
 *   npx tsx scripts/migrate_2026_09_13_fix_misaligned_summaries.ts .env.prod.readonly --dry
 *   npx tsx scripts/migrate_2026_09_13_fix_misaligned_summaries.ts .env.prod.write
 */
import { createClient } from '@libsql/client';
import { config, parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { evalAt, INDEX_RULE, describeAlignment } from '../src/lib/eval-align';

const envPath = process.argv[2];
const dry = process.argv.includes('--dry');
if (!envPath) {
  console.error('使い方: npx tsx scripts/migrate_2026_09_13_fix_misaligned_summaries.ts <envファイル> [--dry]');
  process.exit(1);
}
config({ path: envPath });
// APIキーは書き込み用envに無いので .env.local から拾う（DB接続先は envPath のまま）。
try {
  const local = parse(readFileSync('.env.local'));
  if (local.GOOGLE_GENERATIVE_AI_API_KEY) process.env.GOOGLE_GENERATIVE_AI_API_KEY = local.GOOGLE_GENERATIVE_AI_API_KEY;
} catch { /* 無ければそのまま */ }

const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

const CATS = ['LLM推論', 'エージェント', 'マルチモーダル', '学習手法', 'ハードウェア',
  'ツール/フレームワーク', '研究/論文', 'ビジネス応用', 'セキュリティ', 'その他'] as const;

const FixSchema = z.object({
  items: z.array(z.object({
    index: z.number().int().min(0),
    aiRelevance: z.number().int().min(0).max(10),
    importance: z.number().int().min(0).max(10),
    category: z.enum(CATS),
    summary: z.string().max(600),
  })),
});

async function main() {
  console.log(`接続先: ${String(process.env.TURSO_DATABASE_URL).replace(/:\/\/.*@/, '://***@')}`);
  console.log(dry ? 'モード: --dry（書き込まない）\n' : 'モード: 本番書き込み\n');

  const rows = (await c.execute(`SELECT id, url, title, summary, category, importance_score, ai_relevance
    FROM collected_data WHERE url LIKE '%arxiv.org/abs%' AND created_at >= '2026-09-13 04:00:00'
    ORDER BY id`)).rows as any[];
  if (rows.length === 0) { console.log('対象なし'); return; }
  console.log(`対象 ${rows.length}件`);

  // 実物のabstractを HF API から取る（DBに入っているabstractは信用しない＝それ自体がズレの産物）
  const api = await (await fetch('https://huggingface.co/api/daily_papers?limit=30',
    { headers: { 'User-Agent': 'Cernoval/1.0' } })).json() as any[];
  const byId = new Map<string, any>();
  for (const x of api) if (x.paper?.id) byId.set(String(x.paper.id), x.paper);

  const targets = rows.map(r => {
    const id = String(r.url).split('/abs/')[1];
    return { row: r, id, paper: byId.get(id) };
  }).filter(t => t.paper);

  const missing = rows.length - targets.length;
  if (missing > 0) console.log(`⚠ HF APIに見つからず据え置き: ${missing}件（掲載期間を過ぎた可能性）`);
  if (targets.length === 0) { console.log('作り直せる対象なし'); return; }

  const batchText = targets.map((t, i) =>
    `[${i}] ${t.paper.title}\n${String(t.paper.summary ?? '').replace(/\s+/g, ' ').slice(0, 700)}`
  ).join('\n\n');

  const { object } = await generateObject({
    model: google('gemini-2.5-flash-lite'),
    schema: FixSchema,
    prompt: `以下はarXivに公開されたAI関連の論文です。各論文について、aiRelevance(0-10)、importance(0-10)（AI技術のニュースとして読者にとってどれだけ重要か）、category、日本語summary（6行以内・約150字で、文の途中で切らず必ず言い切る）を生成してください。必ず${targets.length}件分のitemsを返してください。\n\n${batchText}${INDEX_RULE}`,
  });

  console.log(`対応づけ: ${describeAlignment(object.items, targets.length)}\n`);

  let changed = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const ev = evalAt(object.items, i);
    if (!ev) { console.log(`  id=${t.row.id} 評価が返らず据え置き`); continue; }
    console.log(`  id=${t.row.id} arXiv:${t.id}  ${String(t.paper.title).slice(0, 48)}`);
    console.log(`    旧: ★${t.row.importance_score} [${t.row.category}] ${String(t.row.summary).slice(0, 58)}`);
    console.log(`    新: ★${ev.importance} [${ev.category}] ${ev.summary.slice(0, 58)}`);
    if (!dry) {
      await c.execute({
        sql: `UPDATE collected_data SET summary = ?, category = ?, importance_score = ?, ai_relevance = ? WHERE id = ?`,
        args: [ev.summary, ev.category, ev.importance, ev.aiRelevance, t.row.id],
      });
    }
    changed++;
  }
  console.log(`\n${dry ? '（dry）更新する予定: ' : '更新した: '}${changed}件`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
