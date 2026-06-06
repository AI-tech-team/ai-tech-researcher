import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BrainCircuit, ArrowLeft, ArrowRight, Newspaper, Sparkles, Network,
  ShieldCheck, Languages, Clock, BookOpen,
} from 'lucide-react';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: 'このサービスについて',
  description: `${SITE_NAME} とは何か。なぜ作ったのか、どう動くのか、何を大切にしているのか。`,
};

// セクション見出し
function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold text-white font-outfit mt-10 mb-3">{children}</h2>;
}

// 「どう動くか」の各ステップ
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <div className="shrink-0 w-7 h-7 rounded-lg bg-sky-500/15 border border-sky-500/20 flex items-center justify-center font-mono text-xs font-bold text-sky-300">
        {n}
      </div>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-bold text-slate-100">{title}</p>
        <p className="text-[13px] text-slate-400 leading-relaxed mt-0.5">{children}</p>
      </div>
    </div>
  );
}

// 特徴カード
function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
      <div className="flex items-center gap-2 text-sky-300 mb-1.5">
        {icon}<span className="text-sm font-bold text-white">{title}</span>
      </div>
      <p className="text-[13px] text-slate-400 leading-relaxed">{children}</p>
    </div>
  );
}

export default function AboutPage() {
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

      <main className="max-w-2xl mx-auto px-5 py-10 sm:py-14">
        {/* ヒーロー */}
        <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-sky-400/80">About</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-outfit leading-tight mt-2">
          AIの「今」を、<br className="sm:hidden" />毎朝3分で。
        </h1>
        <p className="text-base text-slate-300 leading-relaxed mt-5">
          {SITE_NAME} は、世界中のAI技術ニュース・論文・リリースを<span className="text-white font-medium">毎朝自動で集め、日本語に要約し、分析して届ける</span>リサーチ・サービスです。
          英語を追いかけ続けなくても、AIの最前線で何が起きているかを短時間でつかめます。
        </p>

        {/* なぜ作ったか */}
        <H>なぜ作ったのか</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          AIの進化は、もはや一人で追える速さではありません。毎日のように新しいモデル・論文・ツールが出て、その多くは英語で、玉石混交です。
          「全部に目を通す時間はない。でも重要な変化は見逃したくない」——そんな課題を、自分のために解こうとして作りました。
        </p>
        <p className="text-sm text-slate-400 leading-relaxed mt-3">
          単なるニュースの寄せ集めではなく、<span className="text-slate-200">毎日読むほど賢くなり、長く使うほど価値が出る</span>リサーチの相棒を目指しています。
        </p>

        {/* どう動くか */}
        <H>どう動くのか</H>
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 sm:p-6 space-y-5">
          <Step n={1} title="集める">
            信頼できる16以上の情報源（公式ブログ・論文・技術コミュニティなど）を巡回し、AIに関する新着を自動で収集します。
          </Step>
          <Step n={2} title="要約・分析する">
            それぞれを日本語で要約し、重要度を採点。複数の媒体が同じ話題を報じていれば「何媒体が報じたか」もまとめます。
          </Step>
          <Step n={3} title="つなげる">
            モデルやベンチマークの数値・関係性を抽出して<span className="text-slate-200">知識グラフ</span>に蓄積。「いつ・何が・どれを上回ったか」を時間軸で追えます。
          </Step>
          <Step n={4} title="あなたに合わせる">
            読んだ記事や保存から興味を学習し、あなたの関心に近い新着を「あなた向け」に並べます（ログイン時・任意）。
          </Step>
        </div>

        {/* 特徴 */}
        <H>このサービスの特徴</H>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Feature icon={<Clock size={15} />} title="時間の蓄積">
            毎日観測し続けているので、ベンチマークの推移やモデルの世代交代といった「縦の時間軸」が見えます。新しく立ち上げたツールには出せない強みです。
          </Feature>
          <Feature icon={<Network size={15} />} title="知識グラフ">
            記事を点で終わらせず、モデル・技術・数値のつながりとして蓄積。点ではなく地図でAIを捉えます。
          </Feature>
          <Feature icon={<Sparkles size={15} />} title="あなた向け">
            読み方から興味を学び、あなたに近い新着を優先表示。使うほど精度が上がります。
          </Feature>
          <Feature icon={<Languages size={15} />} title="日本語で、3分で">
            英語の一次情報を日本語の要約で。忙しい朝でも要点だけ素早く。
          </Feature>
        </div>

        {/* 大切にしていること */}
        <H>大切にしていること</H>
        <div className="space-y-4">
          <div className="flex gap-3">
            <Newspaper size={17} className="shrink-0 text-emerald-400 mt-0.5" />
            <p className="text-sm text-slate-400 leading-relaxed">
              <span className="text-slate-200 font-medium">元記事への敬意。</span>{' '}
              本サービスは要約と分析を提供し、本文の全文転載は行いません。詳しく読みたいときは必ず元記事（一次情報）へご案内します。
            </p>
          </div>
          <div className="flex gap-3">
            <ShieldCheck size={17} className="shrink-0 text-sky-400 mt-0.5" />
            <p className="text-sm text-slate-400 leading-relaxed">
              <span className="text-slate-200 font-medium">プライバシー第一。</span>{' '}
              個人を追跡しません。閲覧だけならログイン不要、必要最小限の情報しか扱いません。詳しくは{' '}
              <Link href="/privacy" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">プライバシーポリシー</Link>へ。
            </p>
          </div>
          <div className="flex gap-3">
            <BookOpen size={17} className="shrink-0 text-amber-400 mt-0.5" />
            <p className="text-sm text-slate-400 leading-relaxed">
              <span className="text-slate-200 font-medium">AIは間違えることがあります。</span>{' '}
              要約・分析はAIによる生成物で、誤りを含む可能性があります。重要な判断の前には、必ず元記事や一次情報をご確認ください。
            </p>
          </div>
        </div>

        {/* 使い方・料金 */}
        <H>はじめ方</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          トップページを開くだけで、その日のAIニュースをすぐ読めます。<span className="text-slate-200">閲覧は無料</span>です。
          Googleでログインすると、「あなた向け」のおすすめ・「後で読む」保存・毎朝のダイジェストメール（任意）が使えます。
        </p>

        {/* CTA */}
        <div className="mt-10 rounded-2xl border border-sky-500/15 bg-gradient-to-br from-sky-500/[0.08] to-indigo-500/[0.04] p-6 text-center space-y-3">
          <p className="text-base font-bold text-white">今日のAI、のぞいてみる</p>
          <Link href="/"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 text-white text-sm font-bold shadow-lg shadow-sky-500/20 hover:opacity-90 transition-opacity">
            トップへ <ArrowRight size={15} />
          </Link>
        </div>

        <footer className="mt-12 pt-6 border-t border-white/5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500">
            <Link href="/privacy" className="hover:text-slate-300 transition-colors">プライバシー</Link>
            <span className="text-slate-700">·</span>
            <Link href="/terms" className="hover:text-slate-300 transition-colors">利用規約</Link>
            <span className="text-slate-700">·</span>
            <Link href="/changelog" className="hover:text-slate-300 transition-colors">更新履歴</Link>
          </div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={13} /> トップに戻る
          </Link>
        </footer>
      </main>
    </div>
  );
}
