"use client";

import { useSession, signIn } from 'next-auth/react';
import s from '@/styles/brand.module.css';

/**
 * 「毎朝メールでも受け取る」の導線。
 *
 * 読むだけならログインは要らない、と約束しているので、これは**紙面の後ろ**にだけ置く。
 * ログイン済みの人には出さない（購読の同意は PublicApp 側の一度きりのプロンプトが担当）。
 */
export function MailCta() {
  const { status } = useSession();
  if (status === 'authenticated') return null;
  return (
    <button type="button" className={`${s.btn} ${s.btnSolid}`} onClick={() => signIn('google', { callbackUrl: '/' })}>
      Googleでログインして毎朝メールで受け取る
    </button>
  );
}
