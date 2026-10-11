'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'error';
type ShowToast = (message: string, tone?: ToastTone) => void;

const MAX_VISIBLE = 3;
const DURATION: Record<ToastTone, number> = { info: 5000, success: 5000, error: 8000 };

const tones: Record<ToastTone, string> = {
  info: 'border-ink/15 bg-white text-night',
  success: 'border-seal/20 bg-seal-050 text-seal',
  error: 'border-danger/20 bg-danger-050 text-danger',
};

const ToastContext = createContext<ShowToast | null>(null);

/** Hosts the toast stack and its live region. Mount once near the app root. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; message: string; tone: ToastTone }[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback<ShowToast>(
    (message, tone = 'info') => {
      const id = ++nextId.current;
      setItems((xs) => [...xs.slice(-(MAX_VISIBLE - 1)), { id, message, tone }]);
      setTimeout(() => dismiss(id), DURATION[tone]);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* The live region is always mounted so screen readers announce toasts added later. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:left-auto sm:items-end">
        {items.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : undefined} className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-lg ${tones[t.tone]}`}>
            <p className="flex-1">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="-mr-1 rounded px-1 leading-none opacity-70 hover:opacity-100">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** `const toast = useToast(); toast('Saved', 'success');` */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
