/**
 * v4 フェーズ0 計測スクリプト（読み取り専用・本番Tursoに対して実行）
 * 目的: 「検索0%・抽出100%」の妥当性をデータで検証する。
 *   1. ソース構成比（keyword=Grounding vs 無料フィード）
 *   2. Grounding冗長度（storyグループ単位で無料ソースと重複 or ユニーク）
 *   3. 重要度・エンゲージメント比較（keyword vs 無料）
 *   4. eval重複によるトークン浪費の推定（active フィード数 × recent件 × 実行回数）
 *   5. フィード別収量（直近・自己監視の前段）
 *   6. FTS5サポート確認（ハイブリッドRAGの前提）
 * 実行: v2/ で `npx tsx scripts/measure_v4.ts`
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

// env を複数候補から読み込む（.env.local が無くても root .env で動く）
config({ path: '.env.local' });
config({ path: '.env' });
config({ path: '../.env' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const WINDOW_DAYS = 30;
const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString().replace('T', ' ').slice(0, 19);

const FREE_TYPES = ['rss', 'hn', 'arxiv', 'github', 'url'];
const q = async (sqlText: string, args: any[] = []) => (await client.execute({ sql: sqlText, args })).rows;
const pct = (n: number, d: number) => (d === 0 ? '0.0' : ((n / d) * 100).toFixed(1));
const hr = (t: string) => console.log(`\n${'='.repeat(64)}\n  ${t}\n${'='.repeat(64)}`);

async function main() {
  console.log(`計測ウィンドウ: 直近${WINDOW_DAYS}日（${since} 以降, UTC）`);

  /* ── 1. ソース構成比 ─────────────────────────────────────── */
  hr('1. ソース構成比（記事の出所）');
  const comp = await q(
    `SELECT s.type AS type, COUNT(*) AS cnt
       FROM collected_data c JOIN sources s ON c.source_id = s.id
      WHERE c.created_at >= ?
      GROUP BY s.type ORDER BY cnt DESC`, [since]);
  const total = comp.reduce((a, r: any) => a + Number(r.cnt), 0);
  let kwCount = 0, freeCount = 0;
  for (const r of comp as any[]) {
    const klass = r.type === 'keyword' ? '🔍検索' : FREE_TYPES.includes(r.type) ? '📰抽出' : '❓その他';
    console.log(`  ${String(r.type).padEnd(10)} ${String(r.cnt).padStart(5)}件 (${pct(Number(r.cnt), total)}%) ${klass}`);
    if (r.type === 'keyword') kwCount += Number(r.cnt);
    else if (FREE_TYPES.includes(r.type)) freeCount += Number(r.cnt);
  }
  console.log(`  ${'-'.repeat(40)}`);
  console.log(`  検索(keyword): ${kwCount}件 (${pct(kwCount, total)}%)`);
  console.log(`  抽出(無料)   : ${freeCount}件 (${pct(freeCount, total)}%)`);
  console.log(`  合計         : ${total}件`);

  /* ── 2. Grounding冗長度（storyグループ単位） ───────────────── */
  hr('2. Grounding冗長度（検索由来記事は無料でも取れたか）');
  // story_id が無い記事は自分自身を story とみなす（COALESCE）
  const arts = await q(
    `SELECT COALESCE(c.story_id, c.id) AS story,
            CASE WHEN s.type='keyword' THEN 1 ELSE 0 END AS is_kw
       FROM collected_data c JOIN sources s ON c.source_id = s.id
      WHERE c.created_at >= ?`, [since]);
  const storyMap = new Map<number, { kw: number; free: number }>();
  for (const r of arts as any[]) {
    const st = Number(r.story);
    const e = storyMap.get(st) ?? { kw: 0, free: 0 };
    if (Number(r.is_kw) === 1) e.kw++; else e.free++;
    storyMap.set(st, e);
  }
  let kwRedundant = 0, kwUnique = 0;
  for (const e of storyMap.values()) {
    if (e.kw === 0) continue;
    if (e.free > 0) kwRedundant += e.kw; // 無料ソースも同じstoryを報じている＝冗長
    else kwUnique += e.kw;               // 検索だけが見つけた＝ユニーク貢献
  }
  const kwTotal = kwRedundant + kwUnique;
  console.log(`  検索由来の記事: ${kwTotal}件`);
  console.log(`  └ 冗長(無料も同storyを報道): ${kwRedundant}件 (${pct(kwRedundant, kwTotal)}%)`);
  console.log(`  └ ユニーク(検索のみ発見)   : ${kwUnique}件 (${pct(kwUnique, kwTotal)}%)`);
  console.log(`  → ユニーク率が低いほど「検索を切っても損失が小さい」`);

  /* ── 3. 重要度・エンゲージメント比較 ───────────────────────── */
  hr('3. 価値比較（検索 vs 抽出）— 重要度とユーザー反応');
  const valueRows = await q(
    `SELECT CASE WHEN s.type='keyword' THEN 'kw' ELSE 'free' END AS klass,
            COUNT(*) AS cnt,
            AVG(c.importance_score) AS avg_imp,
            AVG(c.normalized_importance_score) AS avg_norm,
            SUM(c.is_favorited) AS fav,
            SUM(c.is_read_later) AS later,
            SUM(c.is_read) AS read
       FROM collected_data c JOIN sources s ON c.source_id = s.id
      WHERE c.created_at >= ?
      GROUP BY klass`, [since]);
  for (const r of valueRows as any[]) {
    const label = r.klass === 'kw' ? '🔍検索' : '📰抽出';
    const cnt = Number(r.cnt);
    console.log(`  ${label}: ${cnt}件`);
    console.log(`     重要度AVG=${Number(r.avg_imp).toFixed(2)}  正規化AVG=${r.avg_norm != null ? Number(r.avg_norm).toFixed(1) : '—'}`);
    console.log(`     ★お気に入り=${r.fav}(${pct(Number(r.fav), cnt)}%)  後で読む=${r.later}(${pct(Number(r.later), cnt)}%)  既読=${r.read}(${pct(Number(r.read), cnt)}%)`);
  }

  /* ── 4. eval重複によるトークン浪費の推定 ───────────────────── */
  hr('4. eval重複の推定（DB照合前に全件LLM評価している無駄）');
  const activeFeeds = await q(
    `SELECT type, COUNT(*) AS cnt FROM sources
      WHERE status='active' AND type != 'keyword' GROUP BY type`);
  // 1実行あたりの「LLMに渡される候補件数」概算（コレクタ実装の上限値ベース）
  const PER_FEED_ITEMS: Record<string, number> = { rss: 20, arxiv: 10, github: 10, url: 15, hn: 5 };
  let perRunItems = 0;
  for (const r of activeFeeds as any[]) {
    const n = (PER_FEED_ITEMS[r.type] ?? 10) * Number(r.cnt);
    perRunItems += n;
    console.log(`  ${String(r.type).padEnd(8)} active=${r.cnt}  → 1実行で約${n}件をLLM評価`);
  }
  const RUNS_PER_DAY = 3;
  console.log(`  ${'-'.repeat(40)}`);
  console.log(`  1実行の評価候補: 約${perRunItems}件`);
  console.log(`  1日(${RUNS_PER_DAY}回): 約${perRunItems * RUNS_PER_DAY}件をLLM評価`);
  const newPerDay = await q(
    `SELECT COUNT(*) AS cnt FROM collected_data c JOIN sources s ON c.source_id=s.id
      WHERE s.type != 'keyword' AND c.created_at >= ?`, [
      new Date(Date.now() - 7 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)]);
  const newLast7 = Number((newPerDay as any[])[0]?.cnt ?? 0);
  console.log(`  実際に新規挿入された無料記事(直近7日): ${newLast7}件 = 約${(newLast7 / 7).toFixed(1)}件/日`);
  console.log(`  → 「評価した件数」に対し「新規挿入」はごく一部。差分が再評価の無駄。`);

  /* ── 5. フィード別収量（直近30日） ─────────────────────────── */
  hr('5. フィード別収量（収量0は枯れ/壊れの疑い）');
  const yield_ = await q(
    `SELECT s.id, s.type, s.value, s.status, COUNT(c.id) AS cnt
       FROM sources s LEFT JOIN collected_data c
         ON c.source_id = s.id AND c.created_at >= ?
      WHERE s.type != 'keyword'
      GROUP BY s.id ORDER BY cnt DESC`, [since]);
  for (const r of yield_ as any[]) {
    const v = String(r.value).replace(/^https?:\/\//, '').slice(0, 50);
    const flag = Number(r.cnt) === 0 && r.status === 'active' ? '  ⚠️0件' : '';
    console.log(`  ${String(r.cnt).padStart(4)}件  [${String(r.type).padEnd(6)}|${String(r.status).padEnd(9)}] ${v}${flag}`);
  }

  /* ── 6. FTS5サポート確認 ───────────────────────────────────── */
  hr('6. FTS5サポート確認（ハイブリッドRAGの前提）');
  try {
    await client.execute(`CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(body)`);
    await client.execute({ sql: `INSERT INTO _fts_probe(body) VALUES (?)`, args: ['transformer attention mechanism'] });
    const hit = await q(`SELECT body FROM _fts_probe WHERE _fts_probe MATCH 'attention'`);
    await client.execute(`DROP TABLE _fts_probe`);
    console.log(`  ✅ FTS5 利用可能（MATCH検索成功: ${hit.length}件ヒット）`);
  } catch (e: any) {
    console.log(`  ❌ FTS5 利用不可: ${e.message}`);
    console.log(`     → RAGはベクトル＋LIKEフォールバックで設計する`);
  }

  /* ── 7. story グループ統計 ─────────────────────────────────── */
  hr('7. ストーリー統計（重複排除の効き具合）');
  const sizes = [...storyMap.values()].map(e => e.kw + e.free);
  const grouped = sizes.filter(s => s > 1).length;
  console.log(`  ストーリー総数: ${storyMap.size}`);
  console.log(`  複数記事に束ねられたストーリー: ${grouped} (${pct(grouped, storyMap.size)}%)`);
  console.log(`  最大ストーリーサイズ: ${Math.max(...sizes, 0)}件`);

  process.exit(0);
}

main().catch(e => { console.error('計測エラー:', e); process.exit(1); });
