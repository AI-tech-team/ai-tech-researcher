/**
 * 既存記事の ai_relevance をまとめて埋める。
 *
 * 2026-09-13 に ai_relevance 列を足す前に集めた記事は、importance_score 1本で
 * 「AIの話か」と「重要か」を兼任判定されていたため、AI無関係でも★9を持っている。
 * それを一覧・検索・トピックから外せるようにするための遡及判定。
 *
 * ⚠ 判定だけで、既存の値は一切書き換えない（importance_score も削除もしない）。
 *   閾値は保存後に分布を見てから決める。先に落とすと戻せない。
 * ⚠ 再開可能。ai_relevance IS NULL の行だけを拾うので、途中で落ちても続きから走る。
 *
 * 使い方:
 *   npx tsx scripts/backfill_ai_relevance.ts .env.prod.readonly --limit 40 --dry   # 判定だけ見る
 *   npx tsx scripts/backfill_ai_relevance.ts .env.prod.write --limit 200           # 試しに200件
 *   npx tsx scripts/backfill_ai_relevance.ts .env.prod.write                       # 全件
 */
import { createClient } from '@libsql/client';
import { config, parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

const envPath = process.argv[2];
if (!envPath) {
  console.error('使い方: npx tsx scripts/backfill_ai_relevance.ts <envファイル> [--limit N] [--dry]');
  process.exit(1);
}
const dry = process.argv.includes('--dry');
const limArg = process.argv.indexOf('--limit');
const LIMIT = limArg > 0 ? Number(process.argv[limArg + 1]) : Infinity;
const BATCH = 40;

// .env.local から GOOGLE_GENERATIVE_AI_API_KEY を読む。
// ⚠ 指定ファイルを override:true で丸ごと被せてはいけない。.env.prod.readonly は36変数あり、
//   その中の GOOGLE_GENERATIVE_AI_API_KEY が本物のキーを潰して 403 になった（実際に踏んだ）。
//   接続先を取り違えないため、指定ファイルからは **DB接続の2つだけ** を取り出す。
config({ path: '.env.local' });
const target = parse(readFileSync(envPath, 'utf8'));
const dbUrl = target.TURSO_DATABASE_URL;
const dbToken = target.TURSO_AUTH_TOKEN;
if (!dbUrl) { console.error(`${envPath} に TURSO_DATABASE_URL がありません`); process.exit(1); }
const c = createClient({ url: dbUrl, authToken: dbToken });

// daily_pipeline.ts の AI_RELEVANCE_RULE と同じ文言にすること。
// 新規収集と遡及判定で基準がずれると、境目の日付で分布が不連続になって原因が追えなくなる。
const AI_RELEVANCE_RULE = `aiRelevance は「その記事がAI・機械学習の技術そのものを扱っているか」だけを 0-10 で答えてください。記事の出来・話題性・重要さは一切考慮しません。
- 10: AIモデル/研究/基盤技術そのものが主題
- 7: AIを主題に含むが、業界動向・資金調達・規制などの周辺
- 3: AIに少し触れる程度
- 0: AIと無関係（旅行・グルメ・スポーツ・一般ガジェット・一般ニュースなど）
よく書けた記事でも、AIの話でなければ 0 です。`;

const Schema = z.object({
  items: z.array(z.object({
    i: z.number().int(),
    aiRelevance: z.number().int().min(0).max(10),
  })),
});

const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! });

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}

async function main() {
  const host = String(dbUrl).replace(/^libsql:\/\//, '').split('.')[0];
  console.log(`接続先: ${host}  ${dry ? '(dry run・書き込まない)' : '(書き込み)'}  上限 ${LIMIT === Infinity ? '全件' : LIMIT}`);

  const [{ n: total }] = (await c.execute(
    `SELECT COUNT(*) n FROM collected_data WHERE ai_relevance IS NULL`)).rows as any;
  console.log(`未判定: ${total} 件\n`);

  let done = 0, wrote = 0;
  const dist = new Map<number, number>();
  const samples: { s: number; t: string }[] = [];

  while (done < Math.min(Number(total), LIMIT)) {
    const take = Math.min(BATCH, Math.min(Number(total), LIMIT) - done);
    // 書き込む場合は毎回 IS NULL で引き直す（進むので同じ行は二度来ない）。
    // dry run は書き込まないので OFFSET で進める。
    const rows = (await c.execute({
      sql: `SELECT id, COALESCE(title_ja, title) t, COALESCE(summary,'') s
            FROM collected_data WHERE ai_relevance IS NULL ORDER BY id LIMIT ? OFFSET ?`,
      args: [take, dry ? done : 0],
    })).rows as any[];
    if (rows.length === 0) break;

    const batchText = rows.map((r, i) =>
      `[${i}] ${String(r.t).slice(0, 140)}\n${String(r.s).slice(0, 220)}`).join('\n\n');

    const { object } = await withRetry(() => generateObject({
      model: google('gemini-2.5-flash-lite'),
      schema: Schema,
      prompt: `${AI_RELEVANCE_RULE}\n\n次の${rows.length}件それぞれについて、[ ] の中の番号を i として aiRelevance を答えてください。必ず${rows.length}件分返してください。\n\n${batchText}`,
    }));

    const byIndex = new Map(object.items.map(x => [x.i, x.aiRelevance]));
    const writes: { id: number; v: number }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const v = byIndex.get(i);
      if (v == null) continue;               // 返ってこなかった分は次回に回す（NULLのまま）
      writes.push({ id: Number(rows[i].id), v });
      dist.set(v, (dist.get(v) ?? 0) + 1);
      if (v <= 3 && samples.length < 30) samples.push({ s: v, t: String(rows[i].t).slice(0, 60) });
    }

    if (!dry && writes.length > 0) {
      await c.batch(writes.map(w => ({
        sql: `UPDATE collected_data SET ai_relevance = ? WHERE id = ?`,
        args: [w.v, w.id],
      })), 'write');
      wrote += writes.length;
    }
    done += rows.length;
    if (done % 400 === 0 || done >= Math.min(Number(total), LIMIT)) {
      console.log(`  ${done} / ${Math.min(Number(total), LIMIT)} 件  (書込 ${wrote})`);
    }
  }

  console.log('\n=== aiRelevance の分布 ===');
  const keys = [...dist.keys()].sort((a, b) => a - b);
  const sum = [...dist.values()].reduce((s, x) => s + x, 0);
  for (const k of keys) {
    const n = dist.get(k)!;
    console.log(`  ${String(k).padStart(2)}: ${String(n).padStart(5)} 件 (${(n / sum * 100).toFixed(1)}%) ${'█'.repeat(Math.round(n / sum * 60))}`);
  }
  const low = keys.filter(k => k < 6).reduce((s, k) => s + dist.get(k)!, 0);
  console.log(`\n  6未満（新規収集なら弾かれる水準）: ${low} 件 (${(low / sum * 100).toFixed(1)}%)`);

  console.log('\n=== 低く出た記事の実物（目視確認用）===');
  for (const x of samples) console.log(`  ${x.s}: ${x.t}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
