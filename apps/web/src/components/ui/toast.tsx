/**
 * Tiny toast — top-of-screen, single message at a time.
 *
 * The design's feedback was explicit: floating Add buttons + bottom toast
 * interfered with content access. Toast lives at the top, dismisses after
 * 2.4s. Provider mounts a portal at <body>; pages call `useToast().show(msg)`.
 */
import { Check } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface ToastContextValue {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  const show = useCallback((m: string) => {
    setMessage(m);
  }, []);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 2400);
    return () => clearTimeout(t);
  }, [message]);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {message &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 bg-surface-3 border border-border-strong rounded-full px-3.5 py-2 text-[13px] font-medium text-text shadow animate-toast-in"
          >
            <Check size={14} strokeWidth={2.5} className="text-success" />
            {message}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
