"use client";

/**
 * 選別量の点描。「集めた N 本のうち、朝刊に載ったのは M 本」を粒で見せる。
 * 数が多く（1日およそ100〜300粒）SSRのHTMLを膨らませたくないので、描画はクライアントで行う。
 *
 * ⚠ かつてここに ReadTimer（紙面を実際に読んだ秒数を計るコンポーネント）も置いていたが、
 *   紹介ページから朝刊の実物を外したので一緒に削除した（2026-09-11）。
 */
export function SelectionDots({ total, picked, dotClass, pickClass }: {
  total: number; picked: number; dotClass: string; pickClass: string;
}) {
  const n = Math.max(0, Math.min(total, 2000));
  const m = Math.max(0, Math.min(picked, n));
  // 選ばれた粒は等間隔ではなく散らして置く（実際の並びに近い見え方にする）
  const pickedSet = new Set<number>();
  for (let i = 0; i < m; i++) pickedSet.add(Math.floor(((i + 0.6) * n) / (m || 1)));

  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={pickedSet.has(i) ? `${dotClass} ${pickClass}` : dotClass} />
      ))}
    </>
  );
}
