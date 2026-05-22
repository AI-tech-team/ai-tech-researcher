"use client";

import { useState, useEffect } from 'react';

// SSR/静的プリレンダ時はfalse、クライアントマウント後にtrue。
// rechartsのResponsiveContainerを0サイズで描画させない（width(-1)警告回避）ために使う。
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}
