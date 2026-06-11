import { Sparkles } from 'lucide-react';

// 「AIが生成した内容」であることを明示する小バッジ（信頼・透明性／誤情報の信用毀損リスク低減）。
// レポート＝AI生成、記事のサマリー＝AI要約 に付ける。hover で注意書きを表示（JS不要のtitle）。
export function AiBadge({ label = 'AI生成', className = '' }: { label?: string; className?: string }) {
  return (
    <span
      title="AIが自動生成した内容です。誤りを含む可能性があります。重要な判断の前に元記事・一次情報をご確認ください。"
      className={`inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-px rounded border border-violet-400/25 bg-violet-400/10 text-violet-300 ${className}`}
    >
      <Sparkles size={10} /> {label}
    </span>
  );
}
