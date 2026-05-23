"use client";

import React, { Fragment } from 'react';

// インライン要素のMarkdownパーサー
function parseInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // リンク [text](url) / 太字 / 斜体 / コード
  const regex = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const m = match[0];
    const link = m.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const [, label, url] = link;
      // http(s)のみリンク化（javascript:等やリダイレクトURLは弾く）
      if (/^https?:\/\//.test(url) && !url.includes('vertexaisearch.cloud.google.com')) {
        parts.push(<a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">{label}</a>);
      } else {
        parts.push(label);
      }
    } else if (m.startsWith('**'))
      parts.push(<strong key={key++} className="text-white font-semibold">{m.slice(2, -2)}</strong>);
    else if (m.startsWith('*'))
      parts.push(<em key={key++} className="text-slate-300 italic">{m.slice(1, -1)}</em>);
    else if (m.startsWith('`'))
      parts.push(<code key={key++} className="bg-white/10 text-sky-300 px-1.5 py-0.5 rounded text-xs font-mono">{m.slice(1, -1)}</code>);
    lastIndex = match.index + m.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length === 1 ? parts[0] : <Fragment>{parts}</Fragment>;
}

// MarkdownをJSX Nodeのリストに変換
export function renderMarkdown(content: string): React.ReactNode[] {
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  const listItems: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = [...listItems];
    if (listType === 'ul') {
      nodes.push(<ul key={`ul-${nodes.length}`} className="ml-2 mb-3 space-y-1.5 list-none">{items}</ul>);
    } else {
      nodes.push(<ol key={`ol-${nodes.length}`} className="ml-2 mb-3 space-y-1.5 list-none">{items}</ol>);
    }
    listItems.length = 0;
    listType = null;
  };

  lines.forEach((line, i) => {
    if (line.startsWith('### ')) {
      flushList();
      nodes.push(<h4 key={i} className="text-base font-bold text-white mt-5 mb-2">{parseInline(line.slice(4))}</h4>);
    } else if (line.startsWith('## ')) {
      flushList();
      nodes.push(<h3 key={i} className="text-lg font-bold text-sky-400 mt-7 mb-3">{parseInline(line.slice(3))}</h3>);
    } else if (line.startsWith('# ')) {
      flushList();
      nodes.push(<h2 key={i} className="text-xl font-bold text-emerald-400 mt-8 mb-4">{parseInline(line.slice(2))}</h2>);
    } else if (/^[-*] /.test(line)) {
      listType = 'ul';
      listItems.push(
        <li key={i} className="flex gap-2 text-slate-300 text-sm">
          <span className="text-sky-400/60 flex-shrink-0 mt-0.5 select-none">•</span>
          <span>{parseInline(line.slice(2))}</span>
        </li>
      );
    } else if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\./)?.[1] ?? '';
      listType = 'ol';
      listItems.push(
        <li key={i} className="flex gap-2 text-slate-300 text-sm">
          <span className="text-sky-400 flex-shrink-0 font-mono text-xs mt-0.5 w-5">{num}.</span>
          <span>{parseInline(line.replace(/^\d+\. /, ''))}</span>
        </li>
      );
    } else if (line.startsWith('> ')) {
      flushList();
      nodes.push(
        <blockquote key={i} className="border-l-2 border-purple-500/40 pl-4 italic text-slate-400 text-sm my-2">
          {parseInline(line.slice(2))}
        </blockquote>
      );
    } else if (/^[-*]{3,}$/.test(line) || /^={3,}$/.test(line)) {
      flushList();
      nodes.push(<hr key={i} className="border-white/10 my-4" />);
    } else if (!line.trim()) {
      flushList();
      nodes.push(<div key={i} className="h-1.5" />);
    } else {
      flushList();
      nodes.push(<p key={i} className="text-slate-300 text-sm mb-2 leading-relaxed">{parseInline(line)}</p>);
    }
  });
  flushList();
  return nodes;
}

export function Markdown({ content }: { content: string }) {
  return <div>{renderMarkdown(content)}</div>;
}
