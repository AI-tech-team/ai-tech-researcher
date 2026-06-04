import type { Metadata } from 'next';
import Link from 'next/link';
import { BrainCircuit, ArrowLeft } from 'lucide-react';
import { SITE_NAME, CONTACT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: '利用規約',
  description: `${SITE_NAME} のご利用にあたっての条件。`,
};

// セクション見出し
function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-bold text-white font-outfit mt-8 mb-2">{children}</h2>;
}

export default function TermsPage() {
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
        <h1 className="text-2xl font-bold text-white font-outfit">利用規約</h1>
        <p className="text-[11px] font-mono text-slate-500 mt-2">最終更新日: 2026年6月5日</p>

        <p className="text-sm text-slate-300 leading-relaxed mt-6">
          本利用規約（以下「本規約」）は、{SITE_NAME}（以下「本サービス」）の利用条件を定めるものです。
          本サービスを利用された場合、本規約に同意したものとみなします。
        </p>

        <H>1. サービス内容</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本サービスは、公開されているAI・技術関連の情報を自動で収集し、要約・分析してお届けする個人運営の無料サービスです。
          閲覧は無料で、ログインなしでご利用いただけます。一部の機能（保存・あなた向け表示・メール配信など）はGoogleログインが必要です。
        </p>

        <H>2. アカウント</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          ログインにはGoogleアカウントを利用します。アカウントの管理は利用者ご自身の責任で行ってください。
          情報の取り扱いは{' '}
          <Link href="/privacy" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">プライバシーポリシー</Link>
          {' '}に従います。
        </p>

        <H>3. 禁止事項</H>
        <p className="text-sm text-slate-400 leading-relaxed mb-1.5">利用者は、本サービスの利用にあたり次の行為を行ってはなりません。</p>
        <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-1.5">
          <li>法令または公序良俗に違反する行為</li>
          <li>本サービスのサーバー・ネットワークに過度な負荷をかける行為、自動化された大量アクセス・スクレイピング</li>
          <li>不正アクセス、脆弱性の悪用、リバースエンジニアリング等の解析行為</li>
          <li>他の利用者・第三者・運営者の権利を侵害する行為、なりすまし</li>
          <li>本サービスの運営を妨害する行為</li>
        </ul>

        <H>4. コンテンツと知的財産</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本サービスが表示する記事の見出し・本文・画像などの著作権は、各情報源・権利者に帰属します。
          本サービスは、これらの要約・リンク・分析を提供するものであり、元記事の利用は各情報源の規約に従ってください。
          本サービスが生成する要約・レポート等はAIによって自動生成されたものです。
        </p>

        <H>5. AI生成情報に関する免責</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本サービスの要約・分析・レポートは、自動収集およびAIによる生成を含むため、内容の正確性・完全性・最新性を保証しません。
          誤りや不正確な情報が含まれる場合があります。情報はあくまで参考としてご利用いただき、
          技術的・業務的・投資的な判断は、必ず一次情報をご確認のうえ利用者ご自身の責任で行ってください。
        </p>

        <H>6. 免責事項</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本サービスは「現状有姿（as-is）」で提供されます。運営者は、本サービスの利用または利用不能、
          情報の利用、サービスの中断・終了・データの消失等によって生じたいかなる損害についても、
          法令で認められる範囲で責任を負いません。
        </p>

        <H>7. サービスの変更・中断・終了</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          運営者は、利用者への事前の通知なく、本サービスの内容を変更し、または提供を中断・終了することがあります。
        </p>

        <H>8. 準拠法・裁判管轄</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本規約は日本法に準拠して解釈されます。本サービスに関して紛争が生じた場合は、運営者の所在地を管轄する裁判所を専属的合意管轄とします。
        </p>

        <H>9. 規約の変更</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本規約は、必要に応じて変更することがあります。重要な変更がある場合は本ページ上で告知します。
          変更後に本サービスを利用された場合、変更後の規約に同意したものとみなします。
        </p>

        <H>10. お問い合わせ</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本規約に関するご質問は{' '}
          {CONTACT_EMAIL ? (
            <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`${SITE_NAME} お問い合わせ`)}`}
              className="text-sky-400 hover:text-sky-300 underline underline-offset-2">{CONTACT_EMAIL}</a>
          ) : '運営者'}
          {' '}までお寄せください。
        </p>

        <footer className="mt-12 pt-6 border-t border-white/5 flex items-center justify-between">
          <Link href="/privacy" className="text-xs text-slate-400 hover:text-white transition-colors">プライバシーポリシー →</Link>
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> トップに戻る
          </Link>
        </footer>
      </main>
    </div>
  );
}
