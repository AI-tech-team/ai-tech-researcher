import { parseHighlights } from './digest-highlights';

/**
 * ハイライトの「なぜ重要か」が具体か、一般論かを**測るだけ**の道具。書き直させない。
 *
 * なぜ要るか: プロンプトを読むと「何が起きたか」には
 * 「2文目は数字・製品名・組織名といった具体を出すために使う」と書いてあるのに、
 * **「なぜ重要か」には「1文」という長さの指定しかない**。中身の指示がゼロなので
 * LLMは一般論を書く。2026-09-13 の本番の号を読むと 5本中3本が
 * 「〜が求められます」「〜が重要です」型だった（cernoval.com の実物で確認）。
 *
 * ここは商品の核（cernere＝選り分けて、その理由を添える）なので、
 * **まず毎日数える**。直すのはそのあと → [[prove-it]]
 *
 * ## 基準線（直すより先に測った・2026-09-13）
 * `backups/backup_2026-09-06.json` の daily 114号のうち、この形式で取り出せた74号・357項目:
 * **具体 36.4% / 定型句 44.8%**。直近21号だけに絞ると **100項目中35件＝35.0%**、
 * さらに **21号中2号は具体が1本も無い**。つまり**3本に2本が一般論**が今の実力。
 * 直したあとはこの数字と比べる。1日の値では動いたか分からない。
 *
 * ## 2026-09-14 の実測（＝案Bを入れた理由）
 * 09-14 06:00 の号: **具体0本/5本・定型句3本**（基準線36.4%）。
 * 前日に「実務への影響」を廃止した交絡を疑って1日待ったが、**改善しなかった**。
 * ⚠ n=5 なので「悪化した」とは言えない（基準線36.4%でも0本になる確率は10.4%）。
 *   言えるのは「**改善していない**」だけ。だが対照（指示のある項目93.3% / 無い項目36.4%・n=357）と
 *   合わせれば、指示を書かない限り動かないと判断してよい。→ プロンプトに構造の縛りを入れた。
 *
 * ## 案B投入直前の基準線（backup_2026-09-13・2026-09-14 実測）
 * バックアップから daily 全号を測り直した。**対照つき**なので切り分けができる。
 *
 * | 範囲 | なぜ重要か | 何が起きたか（対照） |
 * |---|---|---|
 * | 全体 81号 391項目 | 具体 **33.8%** / 定型句 45.0% | 具体 **93.6%** |
 * | 直近21号 101項目 | 具体 **24.8%** / 定型句 48.5% | 具体 **94.1%** |
 * | 直近3号 15項目 | 具体 **0.0%** | 具体 **93.3%** |
 *
 * 号ごとに並べると、**09-08 を境に 2/5 前後 → 0〜1/5 に落ちている**。
 * - 対照は期間中ずっと 5/5 付近で**まったく動いていない**＝材料が薄くなったのではない。
 * - 読了時間が縮んだのは **09-11 から**（4:43）で、落ち込みの方が**3日早い**＝短縮が原因でもない。
 * - 09-06〜09-09 にレポート生成側のコミットは**無い**（git log で確認）＝こちらの変更でもない。
 *
 * ⇒ 指示の無い項目はモデル側の既定の振る舞いに委ねられており、**黙って劣化する**。
 *   指示のある項目（何が起きたか）が同じ期間まったく揺れていないことが、その対照になっている。
 *   これが案Bで「固有名詞または数字を1つ以上」と明示した理由。
 *   復旧後は直近21号の **24.8%**（直近3号なら0%）と比べる。
 *
 * ⚠ これは**代理指標**であって「良い理由か」を測るものではない。
 *   固有名や数字が入っていても中身が薄いことはある。逆もある。
 *   毎日の推移と、直したときの前後比較に使う。1日の値で結論を出さないこと。
 */

/** 毎回出るので固有名の証拠にならないラテン語。ここに無いラテン語を「固有名らしきもの」と数える。 */
const GENERIC_LATIN = new Set([
  'AI', 'AIS', 'LLM', 'LLMS', 'AGI', 'API', 'APIS', 'RAG', 'GPU', 'GPUS', 'CPU', 'ML', 'DL',
  'IT', 'UI', 'UX', 'SDK', 'OSS', 'SNS', 'PC', 'OS', 'KV', 'B2B', 'B2C', 'SAAS', 'IA', 'AR', 'VR',
]);

/** ラテン文字で始まる語（GPT-5 / Nvidia / Qwen3.8 / llama.cpp を1語として拾う） */
const LATIN_TOKEN = /[A-Za-z][A-Za-z0-9]*(?:[.\-+][A-Za-z0-9]+)*/g;

/** 数字（半角・全角）。「いつ・いくつ・いくら」は具体の一番強い印なので、根拠の先頭に置く。 */
const DIGIT = /[0-9０-９]/;

/** 固有名に混ざって拾われる英語の機能語。根拠の語としては数えない。 */
const STOP_WORDS = new Set(['and', 'the', 'of', 'for', 'in', 'on', 'to', 'a', 'an', 'is', 'are', 'with', 'by', 'or']);

/** 中身を言わずに文を閉じる言い回し。「何が変わるか」を書いていない印。 */
const HEDGE = /(求められ|重要です|重要になり|必要があります|必要となり|期待され|考えられます|示しています|示唆|不可欠|注力|課題となり|可能性があります|注目され)/;

export interface WhyItem {
  /** ハイライトの番号（1始まり） */
  index: number;
  /** 固有名らしきもの または 数字を含む */
  concrete: boolean;
  /** 具体の根拠として拾った語（ログ用・先頭3件） */
  signals: string[];
  /** 中身を言わずに閉じる言い回しを含む */
  hedged: boolean;
}

export interface WhyReport {
  total: number;
  concrete: number;
  hedged: number;
  items: WhyItem[];
}

/**
 * 指定したラベルの本文を同じ物差しで測る。
 *
 * ⚠ 「なぜ重要か」だけを見ていると、下がった日に**プロンプトのせいか、その日のニュースのせいか**が
 *   分からない。対照が要る: 「何が起きたか」には最初から具体の指示があり、同じ号・同じモデルで
 *   **93.3%が具体**（n=357・2026-09-13実測）。両方を毎日出しておけば、
 *   ①なぜ重要かだけ落ちた＝指示の問題 ②両方落ちた＝その日の材料の問題、と切り分けられる。
 *   片方しか測らないのは、対照群を捨てているのと同じ。
 */
export function assessLabel(markdown: string, label: string): WhyReport {
  const items: WhyItem[] = [];
  parseHighlights(markdown).forEach((h, i) => {
    const why = h.points.find(p => p.label === label)?.text;
    if (why === undefined) return;
    const signals = (why.match(LATIN_TOKEN) ?? [])
      .filter(t => !GENERIC_LATIN.has(t.toUpperCase()) && !STOP_WORDS.has(t.toLowerCase()));
    if (DIGIT.test(why)) signals.unshift('数字');
    items.push({
      index: i + 1,
      concrete: signals.length > 0,
      signals: signals.slice(0, 3),
      hedged: HEDGE.test(why),
    });
  });
  return {
    total: items.length,
    concrete: items.filter(x => x.concrete).length,
    hedged: items.filter(x => x.hedged).length,
    items,
  };
}

/** 「なぜ重要か」を測る（従来の入口）。中身は assessLabel と同じ。 */
export function assessWhy(markdown: string): WhyReport {
  return assessLabel(markdown, 'なぜ重要か');
}

/**
 * 対照（何が起きたか）と本命（なぜ重要か）を2行で出す。
 * 対照が落ちていない日に本命だけ低ければ、原因は材料でなく指示。
 */
export function formatSpecificityReport(markdown: string): string {
  return [
    formatLabelReport('なぜ重要か', assessLabel(markdown, 'なぜ重要か')),
    formatLabelReport('何が起きたか（対照）', assessLabel(markdown, '何が起きたか')),
  ].join('\n');
}

/** ログ1行にする。中身（文そのもの）は出さず、判定と根拠の語だけ出す。 */
export function formatLabelReport(label: string, r: WhyReport): string {
  if (r.total === 0) return `[Report] ${label}: 項目を検出できず（形式が変わった可能性）`;
  const detail = r.items
    .map(x => `${x.index}:${x.concrete ? `具体(${x.signals.join(',')})` : '一般論'}${x.hedged ? '+定型句' : ''}`)
    .join(' ');
  return `[Report] ${label} ${r.total}本: 具体${r.concrete}本 / 定型句${r.hedged}本 — ${detail}`;
}

/** 従来の1行版（「なぜ重要か」固定）。 */
export function formatWhyReport(r: WhyReport): string {
  if (r.total === 0) return '[Report] なぜ重要か: 項目を検出できず（形式が変わった可能性）';
  const detail = r.items
    .map(x => `${x.index}:${x.concrete ? `具体(${x.signals.join(',')})` : '一般論'}${x.hedged ? '+定型句' : ''}`)
    .join(' ');
  return `[Report] なぜ重要か ${r.total}本: 具体${r.concrete}本 / 定型句${r.hedged}本 — ${detail}`;
}
