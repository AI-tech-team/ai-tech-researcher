"use client";

import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import type { ToastType } from '@/types';

interface ToastItem { id: string; message: string; type: ToastType; }
interface ToastContextValue { toast: (message: string, type?: ToastType) => void; }

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const remove = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 60, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md pointer-events-auto min-w-[260px] max-w-[360px] ${
                t.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300' :
                t.type === 'error'   ? 'bg-red-950/90 border-red-500/40 text-red-300' :
                                       'bg-slate-900/90 border-sky-500/40 text-sky-300'
              }`}
            >
              {t.type === 'success' ? <CheckCircle size={17} className="flex-shrink-0" /> :
               t.type === 'error'   ? <XCircle size={17} className="flex-shrink-0" /> :
                                       <Info size={17} className="flex-shrink-0" />}
              <span className="text-sm flex-1 leading-snug">{t.message}</span>
              <button onClick={() => remove(t.id)} className="opacity-50 hover:opacity-100 transition-opacity flex-shrink-0 p-0.5">
                <X size={13} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
