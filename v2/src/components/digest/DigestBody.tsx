import Link from 'next/link';
import type { ParsedDigest } from '@/lib/digest';
import s from '@/styles/brand.module.css';

/**
 * 朝刊の本文（紙面）。トップ `/` と 過去の朝刊 `/reports/[id]` で共用する唯一の実装。
 *
 * サーバーコンポーネント。本文はレポート生成時に確定していて対話要素が無いので、
 * クライアントへJSを送る理由がない（旧 ReportView はクライアントだった）。
 *
 * ⚠ **順位も★も点数も出さない**（決定④）。ハイライトの区切りは罫だけで、番号は振らない。
 *   5本は並列であって順位ではない、という約束を紙面の形でも守る。
 */
export function DigestBody({ digest }: { digest: ParsedDigest }) {
  const { lead, highlights, sections } = digest;

  return (
    <div className={s.paperInner}>
      {lead.length > 0 && (
        <div className={s.paperLead}>
          {lead.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      )}

      {highlights.map((h, i) => (
        <article className={s.hl} key={`${i}-${h.title}`}>
          <h2 className={s.hlTitle}>{h.title}</h2>
          <div className={s.points}>
            {h.points.map((p, j) => (
              // ラベルが取れなかった行（古い形式・崩れた行）は本文だけを幅いっぱいに置く。
              // 空のラベル欄を残すと、本文が右半分に寄ったまま理由の分からない余白ができる。
              <div className={p.label ? s.point : s.pointPlain} key={j}>
                {p.label && <p className={s.pointLabel}>{p.label}</p>}
                <p className={s.pointText}>{p.text}</p>
              </div>
            ))}
          </div>
        </article>
      ))}

      {sections.map((sec, i) => (
        <section className={s.sec} key={`${i}-${sec.title}`}>
          <h2 className={s.secTitle}>
            {sec.mark && <span aria-hidden="true">{sec.mark}</span>}
            <b>{sec.title}</b>
          </h2>
          {sec.blocks.map((b, j) => {
            if (b.kind === 'p') return <p className={s.para} key={j}>{b.text}</p>;
            if (b.kind === 'list') {
              return (
                <ul className={s.bullets} key={j}>
                  {b.items.map((it, k) => <li key={k}>{it}</li>)}
                </ul>
              );
            }
            return (
              <div className={s.group} key={j}>
                <h3 className={s.groupTitle}>{b.title}</h3>
                <ul className={s.bullets}>
                  {b.items.map((it, k) => <li key={k}>{it}</li>)}
                </ul>
              </div>
            );
          })}
        </section>
      ))}

      {/* 但し書きは畳んで隠さない（/about の「断定しない」で読者に約束している）。 */}
      <p className={s.note}>
        この朝刊はAIが要約しています。誤りを含むことがあるので、重要な判断の前には元記事をご確認ください。
        選び方と約束は <Link href="/about">このサービスについて</Link> に書いています。
      </p>
    </div>
  );
}
