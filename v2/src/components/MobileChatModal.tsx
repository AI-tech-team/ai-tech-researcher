"use client";

import React, { useRef, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Sparkles, User, Send, X, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Markdown } from '@/components/Markdown';

interface MobileChatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileChatModal({ isOpen, onClose }: MobileChatModalProps) {
  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const isLoading = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isLoading) return;
    sendMessage({ text: chatInput });
    setChatInput('');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: '100%' }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="fixed inset-0 z-50 flex flex-col bg-slate-950"
          style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(56,189,248,0.08) 0%, transparent 60%)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/40 backdrop-blur-md flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-purple-500 flex items-center justify-center text-white shadow-md">
                <Sparkles size={16} />
              </div>
              <div>
                <h2 className="font-bold text-sm font-outfit text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-purple-400">Gemini</h2>
                <p className="text-[10px] text-slate-400">2.5 Flash Lite · DB文脈あり</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors text-slate-400">
              <X size={20} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-slate-500 text-sm mt-16 leading-relaxed px-4">
                <Sparkles size={36} className="mx-auto mb-4 text-sky-400/40" />
                収集データや最新AI技術について<br />何でも質問してください。
                <div className="mt-4 p-3 rounded-xl bg-white/5 border border-white/5 text-left space-y-2">
                  <p className="text-xs text-slate-400 font-medium">使えるコマンド:</p>
                  <p className="text-xs text-sky-400"><code>#deep テーマ</code> — 深掘りリサーチ</p>
                  <p className="text-xs text-purple-400">「○○を後で読むに追加して」</p>
                  <p className="text-xs text-amber-400">「○○をお気に入りに追加して」</p>
                </div>
              </div>
            )}
            {messages.map(m => {
              const textContent = Array.isArray((m as any).parts)
                ? (m as any).parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
                : (m as any).content ?? '';
              return (
                <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    m.role === 'user' ? 'bg-white/10 text-slate-300' : 'bg-gradient-to-br from-sky-400 to-purple-500 text-white'
                  }`}>
                    {m.role === 'user' ? <User size={14} /> : <Sparkles size={14} />}
                  </div>
                  <div className={`p-3 rounded-2xl max-w-[80%] text-sm leading-relaxed break-words ${
                    m.role === 'user'
                      ? 'bg-white/10 text-slate-200 rounded-tr-sm'
                      : 'bg-gradient-to-br from-sky-500/10 to-purple-500/10 border border-white/5 text-slate-200 rounded-tl-sm'
                  }`}>
                    {m.role === 'user' ? textContent : <Markdown content={textContent} />}
                  </div>
                </div>
              );
            })}
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>応答の取得に失敗しました。もう一度お試しください。</span>
              </div>
            )}
            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-sky-400 to-purple-500 text-white">
                  <Sparkles size={14} className="animate-pulse" />
                </div>
                <div className="p-3 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-white/10 bg-black/40 backdrop-blur-md flex-shrink-0">
            <form onSubmit={handleSubmit} className="relative">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="Geminiに質問する..."
                maxLength={1000}
                className="w-full bg-white/5 border border-white/10 rounded-full py-3 pl-5 pr-12 text-sm text-white focus:outline-none focus:border-purple-500/50 transition-colors"
              />
              <button
                type="submit"
                disabled={isLoading || !chatInput.trim()}
                className="absolute right-2 top-2 p-2 bg-gradient-to-r from-sky-500 to-purple-500 text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <Send size={14} />
              </button>
            </form>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
