import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { SITE_NAME, SITE_HOST, CONTACT_EMAIL, RSS_ALTERNATE_TYPES } from '@/lib/site';
import { BrandNav } from '@/components/digest/BrandChrome';

export const metadata: Metadata = {
  title: 'プライバシーポリシー',
  description: `${SITE_NAME} が取得する情報と、その取り扱いについて。`,
  alternates: { canonical: '/privacy', types: RSS_ALTERNATE_TYPES },
};

// セクション見出し
function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-bold text-white font-outfit mt-8 mb-2">{children}</h2>;
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <BrandNav />

      <main className="max-w-2xl mx-auto px-5 py-8 sm:py-10">
        <h1 className="text-2xl font-bold text-white font-outfit">プライバシーポリシー</h1>
        <p className="text-[11px] font-mono text-slate-500 mt-2">最終更新日: 2026年9月13日</p>

        <p className="text-sm text-slate-300 leading-relaxed mt-6">
          {SITE_NAME}（以下「本サービス」）における、利用者の情報の取り扱いについて定めます。
          本サービスは個人の追跡を行わず、必要最小限の情報のみを扱うことを基本方針としています。
        </p>

        <H>取得する情報</H>
        <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-1.5">
          <li><span className="text-slate-200">アカウント情報</span> — Googleログインを利用した場合に、メールアドレス・表示名・プロフィール画像を取得します。</li>
          <li><span className="text-slate-200">アプリ内の操作</span> — お気に入り／後で読む／既読の状態。保存した記事をあなたの端末間で引き継ぐために使います。</li>
        </ul>

        {/* 「IPアドレスを取得しません」と断言していたが、Vercel Web Analytics は訪問者の重複判定のため
            IP+UA からハッシュを生成する。断言と実態が食い違うと、透明性原則違反に加えて表示自体が
            争点になるため、「取得しない」ではなく「追跡目的で利用しない」に改めた（2026-09-10 監査）。 */}
        <H>行わないこと</H>
        <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-1.5">
          <li>IPアドレス・端末識別子・位置情報を用いて、個人を追跡・プロファイリングすることはありません。</li>
          <li>アクセス解析には Vercel Web Analytics を使用します。Cookieは用いず、訪問の重複を判別するために
            IPアドレスとブラウザ情報から一時的なハッシュ値が生成されますが、これは個人を識別する形では保存されず、
            運営者がIPアドレスそのものを参照・保管することはありません。</li>
          <li>広告目的のトラッキング、および取得した情報の第三者への販売は行いません。</li>
        </ul>

        {/* 「方針を宣言する」だけのポリシーは、読む側から真偽を確かめられない。
            2026-09-13、あるAIアシスタントに本サイトについて尋ねた人へ「有料プランがある」
            「クレジットカードを入力させられる」「実態不明なので登録を控えるべき」という
            事実無根の回答が返っていた（実在しない決済の話を含む）。宣言しか無く、
            参照できる事実がサイト上に無かったことが原因。
            そこで**読む側がその場で確かめられる形**に書き換えたのがこの節。
            ⚠ ここに書く項目は、必ず実測してから足すこと（2026-09-13 実測値で作成）。
               1つでも事実と違うと、ポリシー全体の信頼が消える。 */}
        <H>持っていないもの（その場で確かめられます）</H>
        <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-2.5">
          <li>
            <span className="text-slate-200">料金・決済のしくみがありません。</span>
            本サービスは無料で、カード情報を入力する画面はサイト内に一つも存在しません。
            <span className="block text-slate-500 mt-0.5">確かめ方 — ページのソースに決済事業者（Stripe等）のスクリプトが一つも含まれていません。</span>
          </li>
          <li>
            <span className="text-slate-200">外部の追跡スクリプトを読み込みません。</span>
            ページが読み込むスクリプトは、すべて {SITE_HOST} 自身から配信されるものです。
            <span className="block text-slate-500 mt-0.5">
              確かめ方 — ブラウザの開発者ツール「ネットワーク」タブで、接続先ドメインを一覧できます。
              なお上記のアクセス解析（Vercel Web Analytics）も同じドメイン配下で動くため、
              別ドメインとしては現れません。解析そのものを無いとは言っていません。
            </span>
          </li>
          <li>
            <span className="text-slate-200">サイトを読むだけならCookieを一つも発行しません。</span>
            Cookieが発行されるのは、あなたがGoogleでログインしたときのセッション用の1つだけです。
            <span className="block text-slate-500 mt-0.5">確かめ方 — 開発者ツールの「アプリケーション &gt; Cookie」で確認できます。</span>
          </li>
          <li>
            <span className="text-slate-200">閲覧履歴を保存しません。</span>
            どの記事をいつ開いたかの行動ログは、2026年9月13日に、
            過去に残っていた分を<strong className="text-slate-200">テーブルごと削除</strong>しました。
            現在は記録する仕組み自体がありません。
          </li>
          <li>
            <span className="text-slate-200">パスワードを預かりません。</span>
            ログインはGoogleアカウントによる認証のみで、本サービスがあなたのパスワードを受け取ることはありません。
          </li>
          <li>
            <span className="text-slate-200">広告を掲載しません。</span>
            記事の選び方が広告主の都合に左右されることがないようにするためです。
          </li>
        </ul>

        <H>利用目的</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          取得した情報は、保存した記事の管理・メール配信・サービス改善のためにのみ利用します。
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

        {/* 電気通信事業法27条の12（外部送信規律・2023年6月施行）。
            総務省の整理では「各種情報のオンライン提供（ニュース配信等）」は届出不要の第三号事業に
            当たり、**届出義務が無くてもこの規律だけは掛かる**。求められるのは
            「送信される情報の内容・送信先・利用目的」を、それと分かる形で**まとめて**示すこと。
            Vercel Web Analytics の記述は「行わないこと」の節にもあるが、あちらは方針の宣言で、
            ここは規律が要求する開示。重複して見えても、まとめた節が別に必要。
            ⚠ ここに書く送信先を増やす前に、必ず実際のネットワーク送信を確認すること。 */}
        <H>外部送信について（電気通信事業法 第27条の12）</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本サービスの利用にあたり、あなたの端末から次の事業者へ情報が送信されます。送信先・送信される情報・利用目的は以下のとおりです。
        </p>
        <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-2.5 mt-2">
          <li>
            <span className="text-slate-200">アクセス解析 — Vercel Inc.（米国）</span>
            <br />送信される情報: 閲覧したページのURL・参照元・画面サイズ、および通信に伴い送信されるIPアドレスとブラウザ情報。
            後者は訪問の重複を判別する一時的なハッシュ値の生成にのみ用いられます。
            <br />利用目的: どのページがどれだけ読まれたかの集計。Cookieは使用せず、個人を識別する形では保存しません。運営者がIPアドレスそのものを参照・保管することはありません。
          </li>
          <li>
            <span className="text-slate-200">プッシュ通知 — ブラウザ提供元の配信サービス（Google・Mozilla・Apple 等）</span>
            <br />送信される情報: 通知の宛先となるエンドポイントURLと暗号化キー。
            <br />利用目的: 朝刊の更新をお知らせするため。<span className="text-slate-300">通知を許可した場合にのみ発生します。</span>氏名・メールアドレス等は含まれません。
          </li>
          <li>
            <span className="text-slate-200">ログイン — Google LLC（米国）</span>
            <br />送信される情報: 認証に必要な情報、およびGoogleアカウントのメールアドレス・表示名・プロフィール画像。
            <br />利用目的: Googleログインによる本人確認。<span className="text-slate-300">ログインを利用した場合にのみ発生します。</span>
          </li>
        </ul>
        <p className="text-sm text-slate-400 leading-relaxed mt-2">
          上記以外に、広告配信・行動ターゲティングを目的としたタグやSDKは設置していません。
        </p>

        <H>情報の管理</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          取得した情報の漏えい・滅失・毀損を防ぐため、適切な安全管理措置を講じます。
          本サービスの運営に必要な範囲で外部サービス（ホスティング・データベース等）を利用する場合は、信頼できる事業者を選定し、適切に取り扱います。
        </p>

        <H>データの保管と国外移転</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本サービスは、ホスティング・データベース・ログイン認証に外部のクラウドサービス（Vercel・Turso・Google等）を利用しており、
          これらのサーバーは日本国外（米国等）に置かれる場合があります。これらの事業者には必要最小限の範囲で取り扱いを委託し、
          適切な保護措置のもとで管理します。
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
          からも行えます。その他、保有する個人データの開示・訂正・利用停止・削除をご希望の場合は、{CONTACT_EMAIL ? '下記の窓口' : '運営者'}までご連絡ください。本人確認のうえ、法令に従って速やかに対応します。
        </p>

        {/* 公開ログインはEU居住者も来る＝GDPR適用前提（v2/CLAUDE.md 第三条）。
            にもかかわらず13条の必須記載が1つも無かったため追加した（2026-09-10 監査）。 */}
        <H>保存期間</H>
        <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-1.5">
          <li>アカウント情報・アプリ内の操作履歴 — 退会するまで保管し、退会時に削除します。</li>
          <li>メール配信の設定 — 配信を停止すると、以後の送信対象から外れます。</li>
          <li>プッシュ通知の購読情報 — 通知を解除したとき、退会したとき、または端末側で購読が失効したときに削除します。</li>
          <li>アクセス解析の集計値 — 個人と結び付かない集計としてのみ保持します。</li>
        </ul>

        <H>EU/EEA・英国にお住まいの方へ（GDPR）</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          運営者は、あなたの個人データについて管理者（controller）として次のとおり取り扱います。
        </p>
        <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-1.5 mt-1.5">
          <li><span className="text-slate-200">処理の法的根拠</span> — アカウント機能の提供は契約の履行（GDPR 6条1項(b)）、
            サービスの安全確保と改善は正当な利益（同(f)）、メール配信は同意（同(a)）に基づきます。
            同意はいつでも撤回でき、撤回前の処理の適法性には影響しません。</li>
          <li><span className="text-slate-200">あなたの権利</span> — アクセス（15条）、訂正（16条）、消去（17条）、
            処理の制限（18条）、データポータビリティ（20条）、異議（21条）、同意の撤回（7条3項）を行使できます。
            退会はサイト上でいつでも実行でき、その他の請求は下記の窓口で受け付けます。</li>
          <li><span className="text-slate-200">国外移転</span> — ホスティング・データベース・認証に米国等のクラウド事業者を利用しており、
            移転は各事業者の標準契約条項（SCC）または十分性認定に基づいて行われます。</li>
          <li><span className="text-slate-200">苦情の申立て</span> — お住まいの国の監督機関（英国は ICO）に苦情を申し立てる権利があります。</li>
          <li><span className="text-slate-200">自動化された意思決定</span> — 自動化された意思決定やプロファイリングは行いません。
            記事の選別はすべての読者に同一で、個人の閲覧履歴に応じて出し分けることはありません。</li>
        </ul>

        {/* 個人情報保護法32条1項。「本人の知り得る状態」には
            **（本人の求めに応じて遅滞なく回答する場合を含む。）** という括弧書きがあるので、
            運営者の氏名・住所をサイトに常時掲示する義務は無い。ただし「求める」ための窓口は要る
            ＝ CONTACT_EMAIL が未設定だと、この節は義務を満たせない。
            ⚠ env を入れるまで、ここは「窓口が無い」状態のまま。設定を忘れないこと。 */}
        <H>保有個人データに関する事項（個人情報保護法 第32条）</H>
        <ul className="text-sm text-slate-400 leading-relaxed list-disc pl-5 space-y-1.5">
          <li><span className="text-slate-200">運営者</span> — 本サービスは個人が運営しています。運営者の氏名および住所は、
            法令が認める方法により、ご本人からのお求めに応じて遅滞なく回答します。</li>
          <li><span className="text-slate-200">利用目的</span> — アカウント情報はログイン機能の提供とメール配信のため、
            アプリ内の操作（お気に入り／後で読む／既読）は保存した記事を端末間で引き継ぐために利用します。
            これ以外の目的には利用しません。</li>
          <li><span className="text-slate-200">開示等の請求に応じる手続</span> — 開示・訂正・追加・削除・利用停止・第三者提供の停止のご請求は、
            下記の窓口で受け付けます。ご本人であることを確認のうえ、法令に従って対応します。手数料はいただきません。</li>
          <li><span className="text-slate-200">苦情の申出先</span> — 本サービスの個人データの取り扱いに関するお申し出も、同じ窓口で受け付けます。</li>
        </ul>

        <H>お問い合わせ</H>
        <p className="text-sm text-slate-400 leading-relaxed">
          本ポリシーに関するご質問・ご要望、および上記の権利の行使は{' '}
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
