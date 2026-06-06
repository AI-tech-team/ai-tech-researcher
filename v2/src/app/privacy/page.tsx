import type { Metadata } from 'next';
import Link from 'next/link';
import { BrainCircuit, ArrowLeft } from 'lucide-react';
import { SITE_NAME, CONTACT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'プライバシーポリシー',
  description: `${SITE_NAME} が取得する情報と、その取り扱いについて。`,
};

// セクション見出し
function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-bold text-white font-outfit mt-8 mb-2">{children}</h2>;
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#03060f]/85 border-b border-white/5">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-5 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <BrainCircuit className="text-white" size={15} />
            </div>
            <span className="font-bold text-sm font-outfit">{SITE_NAME}</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> トップ
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8 sm:py-10">
        <h1 className="text-2xl font-bold text-white font-outfit">プライバシーポリシー</h1>
        <p className="text-[11px] font-mono text-slate-500 mt-2">最終更新日: 2026年6月6日</p>

        <p className="text-sm text-slate-300 leading-relaxed mt-6">
          {SITE_NAME}（以下「本サービス」）における、利用者の情報の取り扱いについて定めます。
          本サービスは個人の追跡を行わず、必要最小限の情報のみを扱うことを基本方針としています。
        </p>

        <H>取得する情報</H>
        <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-1.5">
          <li><span className="text-slate-200">アカウント情報</span> — Googleログインを利用した場合に、メールアドレス・表示名・プロフィール画像を取得します。</li>
          <li><span className="text-slate-200">アプリ内の操作</span> — お気に入り／後で読む／既読の状態、プロフィールに入力した興味・目標。あなた向けの表示と状態の保存に使います。</li>
        </ul>

        <H>取得しない情報</H>
        <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-1.5">
          <li>IPアドレス・端末識別子・位置情報などを用いた個人の追跡は行いません。</li>
          <li>アクセス解析にはCookieを用いない匿名・集計ベースの計測（Vercel Web Analytics）を使用し、個人を特定しません。</li>
        </ul>

        <H>利用目的</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          取得した情報は、あなた向けのおすすめ表示・保存した記事の管理・サービス改善のためにのみ利用します。
          閲覧のみであればログインは不要で、上記アカウント情報は取得しません。
        </p>

        <H>第三者提供・広告</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          取得した情報を第三者に販売することはありません。広告目的のトラッキングも行いません。
          記事の収集・要約のためにAIモデル等の外部サービスを利用しますが、これに利用者の個人情報を渡すことはありません。
          次の場合を除き、利用者の情報を第三者に提供しません。
        </p>
        <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-1.5 mt-1.5">
          <li>利用者本人の同意がある場合</li>
          <li>法令に基づき開示が求められる場合</li>
          <li>本サービスの運営に必要な範囲で、ホスティング・データベース等の外部サービス事業者に取り扱いを委託する場合</li>
        </ul>

        <H>Cookie</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          ログイン状態を維持するためのセッションCookieのみを使用します。広告・追跡目的のCookieは使用しません。
        </p>

        <H>情報の管理</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          取得した情報の漏えい・滅失・毀損を防ぐため、適切な安全管理措置を講じます。
          本サービスの運営に必要な範囲で外部サービス（ホスティング・データベース等）を利用する場合は、信頼できる事業者を選定し、適切に取り扱います。
        </p>

        <H>データの削除・退会</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          ログイン後、画面右上の「プロフィール」から、いつでも<span className="text-slate-200 font-bold">退会（アカウントと個人データの削除）</span>ができます。
          退会すると、アカウント情報・お気に入り／後で読む／既読の状態・興味/目標・チャット履歴などの個人データをサーバーから削除します（共有の記事データは残ります）。この操作は取り消せません。
        </p>
        <p className="text-sm text-slate-400 leading-relaxed mt-2">
          あわせて、Googleアカウントとの連携解除は
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer"
            className="text-sky-400 hover:text-sky-300 underline underline-offset-2"> Googleアカウントのアクセス管理</a>
          からも行えます。その他、削除に関するご要望は{CONTACT_EMAIL ? '下記の窓口' : '運営者'}までご連絡ください。
        </p>

        <H>お問い合わせ</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本ポリシーに関するご質問・ご要望は{' '}
          {CONTACT_EMAIL ? (
            <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`${SITE_NAME} お問い合わせ`)}`}
              className="text-sky-400 hover:text-sky-300 underline underline-offset-2">{CONTACT_EMAIL}</a>
          ) : '運営者'}
          {' '}までお寄せください。
        </p>

        <H>改定</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本ポリシーは、必要に応じて改定することがあります。重要な変更がある場合は本ページ上で告知します。
        </p>

        <footer className="mt-12 pt-6 border-t border-white/5 flex items-center justify-between">
          <Link href="/terms" className="text-xs text-slate-400 hover:text-white transition-colors">利用規約 →</Link>
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> トップに戻る
          </Link>
        </footer>
      </main>
    </div>
  );
}
