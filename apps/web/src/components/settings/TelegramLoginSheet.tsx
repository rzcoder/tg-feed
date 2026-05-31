/**
 * Multi-step Telegram sign-in wizard rendered inside a Sheet.
 *
 * Steps:
 *   mode → phone → code → ?2fa → done
 *               ↘ raw         ↗
 *
 * The `sessionId` returned from /login/start is held in component state and
 * passed to subsequent /verify and /password calls so the server can keep
 * the temp client alive across HTTP boundaries. Closing the sheet (or
 * clicking Cancel) fires /login/cancel as a best-effort tear-down so the
 * server doesn't have to wait for the TTL GC.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Phone,
  KeyRound,
  FileText,
} from 'lucide-react';
import type { TelegramAccountInfo } from '@tg-feed/shared';
import { apiErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  useCancelTelegramLogin,
  useLoginTelegramRaw,
  useStartTelegramLogin,
  useVerifyTelegramLoginCode,
  useVerifyTelegramLoginPassword,
} from '@/hooks/useTelegramAccount';

type Step = 'mode' | 'phone' | 'code' | '2fa' | 'raw' | 'done';

interface FlowState {
  step: Step;
  phoneNumber: string;
  code: string;
  password: string;
  rawSession: string;
  sessionId: string | null;
  account: TelegramAccountInfo | null;
  error: string | null;
}

const INITIAL: FlowState = {
  step: 'mode',
  phoneNumber: '',
  code: '',
  password: '',
  rawSession: '',
  sessionId: null,
  account: null,
  error: null,
};

export function TelegramLoginSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setState] = useState<FlowState>(INITIAL);
  const toast = useToast();

  const start = useStartTelegramLogin();
  const verifyCode = useVerifyTelegramLoginCode();
  const verifyPassword = useVerifyTelegramLoginPassword();
  const loginRaw = useLoginTelegramRaw();
  const cancel = useCancelTelegramLogin();

  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = state.sessionId;

  const isPending =
    start.isPending || verifyCode.isPending || verifyPassword.isPending || loginRaw.isPending;

  // Reset internal state when reopening so a stale step doesn't flash.
  useEffect(() => {
    if (open) {
      setState(INITIAL);
    }
  }, [open]);

  const closeAndCleanup = (skipCancel = false) => {
    const sid = sessionIdRef.current;
    if (sid && !skipCancel && state.step !== 'done') {
      cancel.mutate({ sessionId: sid });
    }
    onClose();
  };

  const onPhoneSubmit = () => {
    setState((s) => ({ ...s, error: null }));
    start.mutate(
      { phoneNumber: state.phoneNumber.trim() },
      {
        onSuccess: (res) => setState((s) => ({ ...s, step: 'code', sessionId: res.sessionId })),
        onError: (err) =>
          setState((s) => ({ ...s, error: apiErrorMessage(err, 'Could not send code') })),
      },
    );
  };

  const onCodeSubmit = () => {
    if (!state.sessionId) return;
    setState((s) => ({ ...s, error: null }));
    verifyCode.mutate(
      { sessionId: state.sessionId, code: state.code.trim() },
      {
        onSuccess: (res) => {
          if (res.done) {
            setState((s) => ({ ...s, step: 'done', account: res.account }));
            toast.show('Signed in');
          } else {
            setState((s) => ({ ...s, step: '2fa' }));
          }
        },
        onError: (err) =>
          setState((s) => ({ ...s, error: apiErrorMessage(err, 'Verification failed') })),
      },
    );
  };

  const onPasswordSubmit = () => {
    if (!state.sessionId) return;
    setState((s) => ({ ...s, error: null }));
    verifyPassword.mutate(
      { sessionId: state.sessionId, password: state.password },
      {
        onSuccess: (res) => {
          setState((s) => ({ ...s, step: 'done', account: res.account }));
          toast.show('Signed in');
        },
        onError: (err) =>
          setState((s) => ({ ...s, error: apiErrorMessage(err, 'Wrong password') })),
      },
    );
  };

  const onRawSubmit = () => {
    setState((s) => ({ ...s, error: null }));
    loginRaw.mutate(
      { sessionString: state.rawSession.trim() },
      {
        onSuccess: (res) => {
          setState((s) => ({ ...s, step: 'done', account: res.account }));
          toast.show('Signed in');
        },
        onError: (err) =>
          setState((s) => ({ ...s, error: apiErrorMessage(err, 'Invalid session') })),
      },
    );
  };

  const titleByStep: Record<Step, string> = {
    mode: 'Sign in to Telegram',
    phone: 'Enter your phone',
    code: 'Enter the code',
    '2fa': 'Two-step verification',
    raw: 'Paste session string',
    done: 'Signed in',
  };

  const footer = useMemo(() => {
    if (state.step === 'done') {
      return (
        <Button variant="primary" size="sm" onClick={() => closeAndCleanup(true)}>
          Done
        </Button>
      );
    }
    return (
      <>
        <Button variant="ghost" size="sm" onClick={() => closeAndCleanup()} disabled={isPending}>
          Cancel
        </Button>
        <PrimaryAction
          state={state}
          isPending={isPending}
          onClick={() => {
            if (state.step === 'phone') onPhoneSubmit();
            else if (state.step === 'code') onCodeSubmit();
            else if (state.step === '2fa') onPasswordSubmit();
            else if (state.step === 'raw') onRawSubmit();
          }}
        />
      </>
    );
  }, [state, isPending]);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) closeAndCleanup();
      }}
      title={titleByStep[state.step]}
      footer={footer}
    >
      <div className="flex flex-col gap-3">
        {state.error && (
          <div
            role="alert"
            className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-danger-soft text-danger border border-danger/30 text-[12.5px]"
          >
            <AlertTriangle size={13} strokeWidth={2.2} className="flex-shrink-0 mt-px" />
            <span>{state.error}</span>
          </div>
        )}

        {state.step === 'mode' && (
          <div className="flex flex-col gap-1.5">
            <ModeOption
              label="Sign in with phone code"
              description="Telegram sends a code to your account on another device."
              icon={<Phone size={14} />}
              onSelect={() => setState((s) => ({ ...s, step: 'phone' }))}
            />
            <ModeOption
              label="Paste session string"
              description="Use a session minted via pnpm tg:login or another export."
              icon={<FileText size={14} />}
              onSelect={() => setState((s) => ({ ...s, step: 'raw' }))}
            />
          </div>
        )}

        {state.step === 'phone' && (
          <div className="flex flex-col gap-2">
            <BackLink onClick={() => setState((s) => ({ ...s, step: 'mode', error: null }))} />
            <Label htmlFor="tg-phone">Phone number</Label>
            <Input
              id="tg-phone"
              autoFocus
              autoComplete="tel"
              placeholder="+1234567890"
              value={state.phoneNumber}
              onChange={(e) => setState((s) => ({ ...s, phoneNumber: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && onPhoneSubmit()}
              disabled={isPending}
            />
            <Hint>Use the international format (with the leading +).</Hint>
          </div>
        )}

        {state.step === 'code' && (
          <div className="flex flex-col gap-2">
            <BackLink onClick={() => setState((s) => ({ ...s, step: 'phone', error: null }))} />
            <Label htmlFor="tg-code">Login code</Label>
            <Input
              id="tg-code"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="12345"
              monospace
              value={state.code}
              onChange={(e) => setState((s) => ({ ...s, code: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && onCodeSubmit()}
              disabled={isPending}
            />
            <Hint>Telegram sent a 5-digit code to your other device or SMS.</Hint>
          </div>
        )}

        {state.step === '2fa' && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="tg-2fa">Two-step verification password</Label>
            <Input
              id="tg-2fa"
              autoFocus
              type="password"
              autoComplete="current-password"
              value={state.password}
              onChange={(e) => setState((s) => ({ ...s, password: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && onPasswordSubmit()}
              disabled={isPending}
            />
            <Hint>This is the password you set on your Telegram account.</Hint>
          </div>
        )}

        {state.step === 'raw' && (
          <div className="flex flex-col gap-2">
            <BackLink onClick={() => setState((s) => ({ ...s, step: 'mode', error: null }))} />
            <Label htmlFor="tg-raw">Session string</Label>
            <textarea
              id="tg-raw"
              autoFocus
              rows={6}
              spellCheck={false}
              autoComplete="off"
              className={cn(
                'w-full px-3.5 py-2.5 bg-surface text-text border border-border rounded-[var(--radius)]',
                'text-[12.5px] font-mono outline-none transition-[border-color,box-shadow] duration-100',
                'focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]',
                'placeholder:text-text-faint resize-y',
              )}
              placeholder="Paste the StringSession value from `pnpm tg:login`…"
              value={state.rawSession}
              onChange={(e) => setState((s) => ({ ...s, rawSession: e.target.value }))}
              disabled={isPending}
            />
            <Hint>The server will validate by connecting and calling getMe.</Hint>
          </div>
        )}

        {state.step === 'done' && state.account && <DoneCard account={state.account} />}
      </div>
    </Sheet>
  );
}

function PrimaryAction({
  state,
  isPending,
  onClick,
}: {
  state: FlowState;
  isPending: boolean;
  onClick: () => void;
}) {
  if (state.step === 'mode') return null;
  const labels: Record<Exclude<Step, 'mode' | 'done'>, { idle: string; pending: string }> = {
    phone: { idle: 'Send code', pending: 'Sending…' },
    code: { idle: 'Verify', pending: 'Verifying…' },
    '2fa': { idle: 'Confirm', pending: 'Confirming…' },
    raw: { idle: 'Validate & save', pending: 'Validating…' },
  };
  const text =
    state.step === 'phone' || state.step === 'code' || state.step === '2fa' || state.step === 'raw'
      ? labels[state.step]
      : null;
  if (!text) return null;
  const disabled =
    isPending ||
    (state.step === 'phone' && state.phoneNumber.trim().length < 6) ||
    (state.step === 'code' && state.code.trim().length < 4) ||
    (state.step === '2fa' && state.password.length < 1) ||
    (state.step === 'raw' && state.rawSession.trim().length < 8);
  return (
    <Button variant="primary" size="sm" disabled={disabled} onClick={onClick}>
      {isPending ? <Spinner size={13} /> : <ArrowRight size={13} />}
      {isPending ? text.pending : text.idle}
    </Button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start inline-flex items-center gap-1 text-[12px] text-text-muted hover:text-text"
    >
      <ArrowLeft size={12} /> Back
    </button>
  );
}

function ModeOption({
  label,
  description,
  icon,
  onSelect,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors',
        'bg-bg border border-border hover:bg-surface-2',
      )}
    >
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-surface-2 text-text-2 flex-shrink-0 mt-px">
        {icon}
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[13px] font-medium tracking-tight">{label}</div>
        <div className="text-[11.5px] text-text-muted leading-snug">{description}</div>
      </div>
    </button>
  );
}

function DoneCard({ account }: { account: TelegramAccountInfo }) {
  const subtitle = [account.username ? `@${account.username}` : null, account.phoneNumber]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="rounded-lg border border-success/30 bg-success/5 p-3.5 flex items-center gap-2.5">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-success/10 text-success border border-success/30 flex-shrink-0">
        <Check size={14} strokeWidth={2.5} />
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-px">
        <div className="text-[13px] font-medium tracking-tight truncate">
          {account.displayName ?? 'Signed in'}
        </div>
        <div className="text-[11.5px] text-text-muted truncate">{subtitle || 'Connected'}</div>
      </div>
      <KeyRound size={14} className="text-text-muted flex-shrink-0" />
    </div>
  );
}
