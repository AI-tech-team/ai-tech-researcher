import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as schema from '../src/db/schema';

config({ path: '.env.local' }); config({ path: '.env' }); config({ path: '../.env' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client, { schema });

async function backup() {
  const date = new Date().toISOString().split('T')[0];
  const dir = join(process.cwd(), 'backups');
  mkdirSync(dir, { recursive: true });

  // 共有コーパス・知識グラフなど「復旧不能で再構築コストが高い」非PIIデータのみをダンプする。
  // ユーザー個人データ(users/userProfiles/userArticleState/readingEvents/userTopicWeights/chatMemory)は
  // PIIを含むため意図的に除外する。退会時のハード削除(deleteMyAccount)を、git履歴に永久に残る
  // バックアップが無効化してしまう事態を防ぐ（個情法の削除権／匿名性方針）。
  //
  // ⚠️ このJSONは**公開リポジトリにコミットされる**（週次・Actions）。よって載せてよいのは
  // 「公開UIに出してよいもの」だけ＝第三条と同じ基準で判断すること。
  // 2026-07-17: 第三条違反を実測で発見し是正。抽出本文(collected_data.raw_content 847記事369万字)と
  // 本文チャンク(content_chunks.text 3481件425万字)が公開リポジトリに載っていた。
  // 本文の一般公開=公衆送信は著作権法30条の4の射程外＝侵害リスク。UI側(getArticleById)は
  // オーナー限定で守られていたが、バックアップが裏口になっていた。
  // どちらも元URLから再取得可能(PIPELINE_MODE=deep → chunks)＝バックアップする必要が無い。
  const tables: Record<string, any> = {
    sources: schema.sources,
    collectedData: schema.collectedData,
    reports: schema.reports,
    adoptionLogs: schema.adoptionLogs,
    pipelineLogs: schema.pipelineLogs,
    claims: schema.claims,
    entities: schema.entities,
    benchmarks: schema.benchmarks,
    relations: schema.relations,
    researchQuestions: schema.researchQuestions,
    alerts: schema.alerts,
  };

  const out: Record<string, any> = {
    date,
    // 埋め込み(F32_BLOB: collected_data.embedding / chat_memory.embedding / content_chunks.embedding)は
    // 容量が大きく毎週gitにコミットすると肥大化するため除外。本文/テキストから再生成可能:
    //   PIPELINE_MODE=reembed（記事）/ PIPELINE_MODE=chunks（チャンク）。
    note: '公開リポジトリにコミットされるため、抽出本文(raw_content)と本文チャンク(content_chunks)は'
      + '著作権(第三条・公衆送信)により除外。埋め込み(F32_BLOB)は容量のため除外。'
      + '復旧は PIPELINE_MODE=deep（本文再取得）→ chunks（チャンク+埋め込み）→ reembed（記事の埋め込み）。',
  };

  // 列単位で落とすもの（第三条: 抽出本文は公開しない）。列を落としても他の列で復旧価値は保てる。
  // 新しい列が増えても既定で載る＝載せない列だけをここに書く方式にする（列追加時の漏れを防ぐ）。
  const DROP_COLUMNS: Record<string, string[]> = {
    collectedData: ['rawContent'], // 抽出本文。PIPELINE_MODE=deep で元URLから再取得可
  };

  for (const [name, table] of Object.entries(tables)) {
    const rows = await db.select().from(table);
    const drop = DROP_COLUMNS[name];
    out[name] = drop ? rows.map(r => { const o = { ...(r as any) }; for (const c of drop) delete o[c]; return o; }) : rows;
  }

  // content_chunks(本文チャンク)はダンプしない。中身が抽出本文そのもの＝公開リポジトリに置けない。
  // 復旧は PIPELINE_MODE=deep（本文再取得）→ PIPELINE_MODE=chunks（再チャンク＋再埋め込み）。

  const filePath = join(dir, `backup_${date}.json`);
  writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf-8');

  console.log(`[Backup] 完了: ${filePath}`);
  for (const [name, rows] of Object.entries(out)) {
    if (!Array.isArray(rows)) continue;
    console.log(`  ${name}: ${rows.length}件`);
  }
  process.exit(0);
}

backup().catch(e => { console.error(e); process.exit(1); });
