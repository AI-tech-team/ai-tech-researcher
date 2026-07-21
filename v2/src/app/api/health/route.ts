import { client } from '@/db';
import { isOwner } from '@/lib/owner';
import { cached } from '@/lib/cache';

// 外形監視用のヘルスチェック。
//
// 経緯: DBが全滅してもUIは HTTP 200 ＋「記事がまだありません」を返す。actions.ts の各クエリが
// catch → return [] でfail-openするためで、外形監視からは正常に見えてしまう
// （2026-06-19〜07-08のDB split-brain停止を19日間検知できなかった直接の原因）。
// UI側のfail-openは「一部クエリの失敗で全画面を落とさない」表示挙動としては正しいので、
// そちらは変えず、検知だけをこの別経路で行う。
//
// 判定: down(500)=DBが死んでいる / degraded(503)=DBは生きているが供給か索引が壊れている / ok(200)。
// 監視サービス側は「200以外で通知」に設定すれば両方拾える。
// Route Handlerは既定でキャッシュされないため dynamic 指定は不要。連打によるTurso読み取り課金だけ
// 20秒メモリキャッシュで抑える（監視間隔は5分を想定）。

// ベクトル索引の照会は1本あたり3〜4.5秒かかる（本番実測）。2本を直列にすると7.7秒に達したので
// 並列で叩く。Vercel既定のタイムアウトに触れないよう上限も明示する。
export const maxDuration = 15;

// vector_top_k はインデックスが欠損すると実行時エラーになる。実際に1件引いて生存を確かめる
// （content_chunks の行数を数えてもインデックス自体の健全性は分からない）。次元数は埋め込みと同じ768。
const PROBE_VECTOR = JSON.stringify(Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)));

// 収集は毎日04:07 JST。2回続けて落ちた時点で異常とみなす。
const STALE_MS = 48 * 60 * 60 * 1000;

// created_at は 'YYYY-MM-DD HH:MM:SS'（空白区切り・UTC・Z無し）で格納される。
// actions.ts の sqlTs() と対になる逆変換（Zを補わないとローカル時刻として解釈され、時差ぶんずれる）。
function parseSqlTs(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(`${s.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : null;
}

type Check = { ok: boolean; detail?: string };

async function runChecks(): Promise<{ fatal: boolean; checks: Record<string, Check> }> {
  const checks: Record<string, Check> = {};
  const now = Date.now();

  // 1) DB疎通＋記事の存在。COUNT(*) は全走査になるので存在確認だけにする。
  //    ここが落ちる＝サイトが空になる状態なので、これだけを fatal(500) 扱いにする。
  let fatal = false;
  try {
    const r = await client.execute('SELECT id FROM collected_data LIMIT 1');
    if (r.rows.length > 0) {
      checks.db = { ok: true };
    } else {
      checks.db = { ok: false, detail: 'collected_data is empty' };
      fatal = true;
    }
  } catch (e) {
    checks.db = { ok: false, detail: (e as Error)?.message?.slice(0, 200) };
    fatal = true;
  }

  // DBに繋がらないなら後続は全て同じ理由で落ちる。無駄な問い合わせをせず打ち切る。
  if (fatal) return { fatal, checks };

  // 残りは互いに独立なので並列で叩く（直列だとベクトル索引2本だけで7.7秒かかる）。
  //
  // ⚠ 鮮度は MAX(created_at) では取らない。この列に索引が無く全走査になり、本番実測で32秒かかった。
  //   主キー降順の1行読みなら51ms で、値も MAX(created_at) と一致することを実測で確認済み。
  const ageCheck = async (
    key: string,
    sql: string,
    label: string,
  ): Promise<[string, Check]> => {
    try {
      const r = await client.execute(sql);
      const last = parseSqlTs(r.rows[0]?.t as string | null);
      if (last === null) return [key, { ok: false, detail: `no ${label}` }];
      const hours = Math.round((now - last) / 3_600_000);
      return [key, { ok: now - last < STALE_MS, detail: `last ${label} ${hours}h ago` }];
    } catch (e) {
      return [key, { ok: false, detail: (e as Error)?.message?.slice(0, 200) }];
    }
  };

  // ベクトル索引の生存。retrieval.ts は索引が壊れても console.warn して検索を続けるため
  // （語彙検索だけで結果が出てしまい）品質低下に気づけない。ここで明示的に叩いて可視化する。
  const indexCheck = async (idx: string): Promise<[string, Check]> => {
    try {
      const r = await client.execute({
        sql: `SELECT id FROM vector_top_k('${idx}', vector32(?), 1)`,
        args: [PROBE_VECTOR],
      });
      return [idx, r.rows.length > 0 ? { ok: true } : { ok: false, detail: 'index returned no rows' }];
    } catch (e) {
      return [idx, { ok: false, detail: (e as Error)?.message?.slice(0, 200) }];
    }
  };

  const results = await Promise.all([
    // 2) 記事の鮮度。パイプラインが止まっても既存記事は表示され続けるため、件数では気づけない。
    ageCheck('freshness', 'SELECT created_at AS t FROM collected_data ORDER BY id DESC LIMIT 1', 'article'),
    // 3) 日次レポートの供給。06:00 JST配信なので、48h無いなら生成か配信が壊れている。
    ageCheck('dailyReport', "SELECT created_at AS t FROM reports WHERE type = 'daily' ORDER BY id DESC LIMIT 1", 'report'),
    indexCheck('collected_embedding_idx'),
    indexCheck('chunk_embedding_idx'),
  ]);
  for (const [key, check] of results) checks[key] = check;

  return { fatal, checks };
}

export async function GET() {
  const { fatal, checks } = await cached('health', 20_000, runChecks);

  const status = fatal ? 'down' : Object.values(checks).every(c => c.ok) ? 'ok' : 'degraded';
  const httpStatus = fatal ? 500 : status === 'ok' ? 200 : 503;

  // 詳細（DBのエラー文・最終更新時刻）は運用情報かつ内部構造の露出になるのでオーナー限定。
  // 匿名には各チェックの ok/ng だけを返す（外形監視はこれで足りる）。
  const owner = await isOwner();
  const body = owner
    ? { status, checks }
    : {
        status,
        checks: Object.fromEntries(
          Object.entries(checks).map(([k, v]) => [k, v.ok ? 'ok' : 'ng']),
        ),
      };

  return Response.json(body, {
    status: httpStatus,
    headers: { 'Cache-Control': 'no-store' },
  });
}
