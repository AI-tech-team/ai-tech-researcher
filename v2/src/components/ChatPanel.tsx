"use client";

import React, { useRef, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Sparkles, User, Send, ChevronRight, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function ChatPanel() {
  const [isOpen, setIsOpen] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({
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
    <div
      className="flex-shrink-0 border-l border-white/5 flex transition-all duration-300 ease-in-out"
      style={{ width: isOpen ? '288px' : '44px' }}
    >
      {/* Toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-11 flex-shrink-0 flex flex-col items-center justify-center gap-2 border-r border-white/5 hover:bg-white/5 transition-colors py-4"
        title={isOpen ? 'チャットを閉じる' : 'Geminiチャットを開く'}
      >
        {isOpen
          ? <ChevronRight size={16} className="text-slate-400" />
          : <>
              <ChevronLeft size={16} className="text-slate-400" />
              <Sparkles size={13} className="text-sky-400" />
            </>
        }
      </button>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-1 flex flex-col relative bg-black/20 overflow-hidden min-w-0"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-sky-500/5 to-purple-500/5 pointer-events-none" />

            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center gap-3 relative z-10 bg-black/40 backdrop-blur-md flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-purple-500 flex items-center justify-center text-white shadow-md flex-shrink-0">
                <Sparkles size={16} />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-sm font-outfit text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-purple-400">Gemini</h3>
                <p className="text-[10px] text-slate-400 truncate">2.5 Flash Lite · DB文脈あり</p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 relative z-10">
              {messages.length === 0 && (
                <div className="text-center text-slate-500 text-xs mt-8 px-4 leading-relaxed">
                  <Sparkles size={26} className="mx-auto mb-3 text-sky-400/40" />
                  収集データや最新AI技術について<br />何でも質問してください。
                </div>
              )}
              {messages.map(m => {
                const textContent = Array.isArray((m as any).parts)
                  ? (m as any).parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
                  : (m as any).content ?? '';
                return (
                  <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                      m.role === 'user'
                        ? 'bg-white/10 text-slate-300'
                        : 'bg-gradient-to-br from-sky-400 to-purple-500 text-white'
                    }`}>
                      {m.role === 'user' ? <User size={12} /> : <Sparkles size={12} />}
                    </div>
                    <div className={`p-2.5 rounded-2xl max-w-[85%] text-xs leading-relaxed break-words ${
                      m.role === 'user'
                        ? 'bg-white/10 text-slate-200 rounded-tr-sm'
                        : 'bg-gradient-to-br from-sky-500/10 to-purple-500/10 border border-white/5 text-slate-200 rounded-tl-sm'
                    }`}>
                      {textContent}
                    </div>
                  </div>
                );
              })}
              {isLoading && (
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-sky-400 to-purple-500 text-white">
                    <Sparkles size={12} className="animate-pulse" />
                  </div>
                  <div className="p-2.5 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-white/5 bg-black/40 backdrop-blur-md relative z-10 flex-shrink-0">
              <form onSubmit={handleSubmit} className="relative">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Geminiに質問する..."
                  maxLength={1000}
                  className="w-full bg-white/5 border border-white/10 rounded-full py-2.5 pl-4 pr-10 text-xs text-white focus:outline-none focus:border-purple-500/50 transition-colors"
                />
                <button
                  type="submit"
                  disabled={isLoading || !chatInput.trim()}
                  className="absolute right-1.5 top-1.5 p-1.5 bg-gradient-to-r from-sky-500 to-purple-500 text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  <Send size={12} />
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
