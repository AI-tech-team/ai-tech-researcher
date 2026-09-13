/**
 * collected_data に ai_relevance 列を足す。
 *
 * 「AIの話か」と「記事として重要か」を importance_score 1本に兼任させていたため、
 * よく書けた無関係記事が高得点になっていた（「新潟駅徒歩圏で完結する1泊2日観光モデル
 * ルート」★9 など・2026-09-12 実測）。判定を構造で分けるための列。
 *
 * ⚠ NULL は「未判定」であって「無関係」ではない。表示側は NULL を落とさないこと。
 *   0 と NULL を混ぜると、判定できなかった記事を毎回引き直すことになる。
 *
 * 使い方:
 *   npx tsx scripts/migrate_2026_09_13.ts .env.prod.write        # 適用
 *   npx tsx scripts/migrate_2026_09_13.ts .env.prod.readonly --dry  # 確認だけ
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

const envPath = process.argv[2];
const dry = process.argv.includes('--dry');
if (!envPath) {
  console.error('使い方: npx tsx scripts/migrate_2026_09_13.ts <envファイル> [--dry]');
  process.exit(1);
}
config({ path: envPath });

const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql: string, args: any[] = []) => (await c.execute({ sql, args })).rows;

async function main() {
  // 接続先を必ず出す（dev と prod は1文字違い＝ -dev- / -db- で、取り違えると気づけない）
  const host = String(process.env.TURSO_DATABASE_URL).replace(/^libsql:\/\//, '').split('.')[0];
  console.log(`接続先: ${host}  ${dry ? '(dry run)' : '(書き込み)'}`);

  const cols = await q(`PRAGMA table_info(collected_data)`);
  const has = cols.some(r => String(r.name) === 'ai_relevance');
  console.log(`ai_relevance 列: ${has ? 'すでにある' : 'まだ無い'}`);

  if (!has) {
    if (dry) {
      console.log('  → ALTER TABLE collected_data ADD COLUMN ai_relevance INTEGER;  (dry run のため実行しない)');
    } else {
      await c.execute(`ALTER TABLE collected_data ADD COLUMN ai_relevance INTEGER`);
      console.log('  → 追加した');
    }
  }

  // 一覧・検索は「重要度が高い順」に引くので、絞り込みが後段に来る。
  // ai_relevance 単独の索引ではなく (importance_score, ai_relevance) の複合にする。
  const idx = await q(`SELECT name FROM sqlite_master WHERE type='index' AND name='collected_ai_rel_idx'`);
  if (idx.length === 0) {
    if (dry) {
      console.log('  → CREATE INDEX collected_ai_rel_idx ...  (dry run のため実行しない)');
    } else {
      await c.execute(`CREATE INDEX collected_ai_rel_idx ON collected_data (importance_score DESC, ai_relevance)`);
      console.log('  → 索引 collected_ai_rel_idx を作った');
    }
  } else {
    console.log('索引 collected_ai_rel_idx: すでにある');
  }

  const [n] = await q(`SELECT COUNT(*) n FROM collected_data`);
  const [u] = await q(`SELECT COUNT(*) n FROM collected_data WHERE ai_relevance IS NULL`).catch(() => [{ n: '—' }] as any);
  console.log(`\n全記事 ${n.n} 件 / 未判定 ${u.n} 件 → scripts/backfill_ai_relevance.ts で埋める`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
