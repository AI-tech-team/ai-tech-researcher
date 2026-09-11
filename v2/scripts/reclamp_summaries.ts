/**
 * 既存の尻切れ/長すぎる要約を clampSummary で6行相当に整える一括処理（LLM不使用・コストゼロ）。
 * 本番データの一括UPDATEなので、既定は dry-run（表示のみ）。実行は APPLY=1 を付ける。
 *   dry-run: npx tsx scripts/reclamp_summaries.ts
 *   適用:    APPLY=1 npx tsx scripts/reclamp_summaries.ts
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });

const SUMMARY_MAX = 200;
function clampSummary(s: string | null | undefined): string {
  const t = String(s ?? '').trim();
  if (t.length <= SUMMARY_MAX) return t;
  const head = t.slice(0, SUMMARY_MAX);
  const end = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'));
  if (end >= 60) return head.slice(0, end + 1);
  const soft = Math.max(head.lastIndexOf('、'), head.lastIndexOf(' '));
  return (soft >= 60 ? head.slice(0, soft) : head).trim();
}

async function main() {
  const apply = process.env.APPLY === '1';
  const rows = (await client.execute(
    `SELECT id, summary FROM collected_data WHERE summary IS NOT NULL AND length(summary) > ${SUMMARY_MAX}`
  )).rows;
  console.log(`対象(要約が${SUMMARY_MAX}字超): ${rows.length}件 / モード: ${apply ? '本番適用' : 'dry-run(表示のみ)'}\n`);

  let changed = 0;
  const samples: string[] = [];
  for (const r of rows) {
    const before = String(r.summary);
    const after = clampSummary(before);
    if (after !== before && after.length > 0) {
      changed++;
      if (samples.length < 5) {
        samples.push(`[${r.id}] ${before.length}字→${after.length}字\n   前: …${before.slice(-40)}\n   後: …${after.slice(-40)}`);
      }
      if (apply) {
        await client.execute({ sql: `UPDATE collected_data SET summary = ? WHERE id = ?`, args: [after, Number(r.id)] });
      }
    }
  }
  console.log('■ 変更例(末尾40字):');
  for (const s of samples) console.log(s + '\n');
  console.log(`■ ${apply ? '整形して更新した' : '整形対象'}: ${changed}件 / 平均短縮の対象は末尾が句点で言い切りに。`);
  if (!apply) console.log('→ 問題なければ APPLY=1 を付けて再実行で本番反映。');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
