"use client";

import { useEffect, useRef, useState } from 'react';
import { formatReadingTime } from '@/lib/reading-time';

/**
 * 「3分で読めます」と書く以上、実際に計って見せる。
 * 紙面の見出しが画面に入ったら数え始め、末尾に着いたら止める。
 *
 * 初期表示は実測の見積り（600字/分で算出した秒数）。JSが動かない環境でもそれが出るだけで、
 * ページの意味は変わらない。
 */
export function ReadTimer({ estimateSeconds }: { estimateSeconds: number }) {
  const [label, setLabel] = useState(() => `${formatReadingTime(estimateSeconds)}で読めます`);
  const startedRef = useRef(0);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const head = document.getElementById('fpHead');
    const end = document.getElementById('fpEnd');
    if (!head || !end) return;

    let tick: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    const startObs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || startedRef.current) continue;
        startedRef.current = Date.now();
        startObs.disconnect();
        tick = setInterval(() => {
          if (!stopped) setLabel(formatReadingTime((Date.now() - startedRef.current) / 1000));
        }, 1000);
      }
    }, { threshold: 0.9 });
    startObs.observe(head);

    const endObs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || !startedRef.current || stopped) continue;
        const elapsed = (Date.now() - startedRef.current) / 1000;
        // 紙面が短い日は見出しと末尾が同時に視界へ入り、開始直後に「0秒 で読了」と出てしまう
        // （実機で発覚・2026-09-11）。読んだとは言えない長さなら見積りのまま置いておく。
        if (elapsed < 3) continue;
        stopped = true;
        if (tick) clearInterval(tick);
        setLabel(`${formatReadingTime(elapsed)} で読了`);
      }
    }, { threshold: 0.6 });
    endObs.observe(end);

    return () => { stopped = true; if (tick) clearInterval(tick); startObs.disconnect(); endObs.disconnect(); };
  }, []);

  return <span aria-live="off">{label}</span>;
}

/**
 * 選別量の点描。「集めた N 本のうち、朝刊に載ったのは M 本」を粒で見せる。
 * 数が多く（1日およそ200〜300粒）SSRのHTMLを膨らませたくないので、描画はクライアントで行う。
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
