/**
 * Tiny toast — top-of-screen, single message at a time.
 *
 * The design's feedback was explicit: floating Add buttons + bottom toast
 * interfered with content access. Toast lives at the top, dismisses after
 * 2.4s. Provider mounts a portal at <body>; pages call `useToast().show(msg)`
 * for confirmations and `useToast().error(msg)` for failures — the two render
 * with distinct icon + color so a failure never looks like a success.
 */
import { AlertTriangle, Check } from 'lucide-react';
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
import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'error';

interface ToastState {
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  /** Success confirmation (green check). */
  show: (message: string) => void;
  /** Failure (danger triangle + tint). */
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const show = useCallback((message: string) => setToast({ message, tone: 'success' }), []);
  const error = useCallback((message: string) => setToast({ message, tone: 'error' }), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const value = useMemo(() => ({ show, error }), [show, error]);

  const isError = toast?.tone === 'error';

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast &&
        createPortal(
          <div
            role="status"
            aria-live={isError ? 'assertive' : 'polite'}
            className={cn(
              'fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium shadow animate-toast-in border',
              isError
                ? 'bg-danger-soft text-danger border-danger/40'
                : 'bg-surface-3 text-text border-border-strong',
            )}
          >
            {isError ? (
              <AlertTriangle size={14} strokeWidth={2.5} className="text-danger" />
            ) : (
              <Check size={14} strokeWidth={2.5} className="text-success" />
            )}
            {toast.message}
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
