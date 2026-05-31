import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Hint } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { LogoBadge } from '@/components/domain/Logo';
import { useLogin, useMe, useTelegramLogin, UnauthorizedError } from '@/hooks/useAuth';
import { apiErrorMessage } from '@/api/client';
import {
  detectTelegramLaunch,
  initTelegramViewport,
  waitForTelegramInitData,
} from '@/lib/telegram';

interface LocationState {
  from?: { pathname?: string };
}

export function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const tgLogin = useTelegramLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tgFailed, setTgFailed] = useState(false);
  // Resolved Telegram initData: `undefined` while waiting for the async SDK,
  // `null` when this isn't a Telegram launch, or the signed string.
  const [initData, setInitData] = useState<string | null | undefined>(() =>
    detectTelegramLaunch() ? undefined : null,
  );
  // One-shot guard for the auto sign-in; a ref so it survives StrictMode's
  // double-invoked effects.
  const attemptedRef = useRef(false);

  // Resolve initData (waiting briefly for the async SDK on a launch) and signal
  // the viewport ready.
  useEffect(() => {
    if (initData !== undefined) return;
    let cancelled = false;
    void waitForTelegramInitData().then((data) => {
      if (cancelled) return;
      if (data) initTelegramViewport();
      setInitData(data);
    });
    return () => {
      cancelled = true;
    };
  }, [initData]);

  // Auto sign-in via Telegram once initData and `/me` resolve; on failure the
  // password form takes over.
  useEffect(() => {
    if (initData === undefined || me.isPending || me.data?.authenticated) return;
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    if (initData === null) return; // not a Telegram launch
    tgLogin.mutate(initData, {
      onError: () => setTgFailed(true),
    });
  }, [initData, me.isPending, me.data, tgLogin]);

  // If already authed, bounce to wherever the user came from (or /).
  useEffect(() => {
    if (me.data?.authenticated) {
      const dest = (location.state as LocationState | null)?.from?.pathname ?? '/';
      navigate(dest, { replace: true });
    }
  }, [me.data, navigate, location.state]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!password || login.isPending) return;
    setError(null);
    login.mutate(password, {
      onError: (err) => {
        if (err instanceof UnauthorizedError) {
          setError('Wrong password.');
          return;
        }
        setError(apiErrorMessage(err, 'Network error. Try again.'));
      },
    });
  };

  // Avoid a flash of the login form while /me is still resolving.
  if (me.isPending) {
    return (
      <div className="grid place-items-center min-h-dvh text-text-muted">
        <Spinner />
      </div>
    );
  }

  if (me.data?.authenticated) {
    return <Navigate to="/" replace />;
  }

  // Show the spinner while initData is resolving or the auto sign-in is in
  // flight; drop to the password form on failure or when not a Telegram launch.
  const awaitingTelegram = initData === undefined || (initData !== null && !tgFailed);
  if (awaitingTelegram) {
    return (
      <div role="status" className="grid place-items-center min-h-dvh text-text-muted gap-3">
        <Spinner />
        <div className="text-[13px]">Authorizing via Telegram…</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh grid place-items-center px-6 bg-bg text-text">
      <div className="w-full max-w-[360px]">
        <div className="flex flex-col items-center mb-7">
          <LogoBadge size={28} className="mb-3.5 w-[52px] h-[52px] rounded-[14px]" />
          <div className="text-[22px] font-semibold tracking-tight">tg-feed</div>
          <div className="text-[13px] text-text-muted mt-1">operator console</div>
        </div>

        {tgFailed ? (
          <div
            role="alert"
            className="mb-4 text-[12.5px] text-text-muted bg-surface-2 rounded-lg px-3 py-2.5 flex items-start gap-2"
          >
            <AlertTriangle size={13} strokeWidth={2.2} className="mt-0.5 shrink-0 text-danger" />
            <span>Telegram sign-in didn’t go through. Use your password below.</span>
          </div>
        ) : null}

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                invalid={!!error}
                placeholder="••••••••"
                autoFocus
                autoComplete="current-password"
                style={{ paddingRight: 40 }}
                aria-describedby={error ? 'login-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1 w-8 h-8 grid place-items-center rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
              >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {error ? (
              <div
                id="login-error"
                role="alert"
                className="mt-2 text-[12.5px] text-danger flex items-center gap-1.5"
              >
                <AlertTriangle size={12} strokeWidth={2.2} />
                {error}
              </div>
            ) : (
              <Hint>Set via the WEB_PASSWORD env on the server.</Hint>
            )}
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={!password || login.isPending}
            className="w-full mt-1"
          >
            {login.isPending ? (
              <>
                <Spinner size={16} />
                Signing in…
              </>
            ) : (
              <>
                <Lock size={15} />
                Unlock
              </>
            )}
          </Button>
        </form>

        <div className="mt-7 text-[11.5px] text-text-faint text-center tracking-wide">
          single-user · self-hosted
        </div>
      </div>
    </div>
  );
}
