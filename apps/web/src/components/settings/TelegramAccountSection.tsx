/**
 * Settings → Connection card.
 *
 * Replaces the read-only status block with a richer view that lets the
 * operator sign in (phone-code or paste-session), and sign out. Renders
 * different states based on `useTelegramAccount()` and `useSystemStatus()`:
 *
 *  - Connected via DB row → green dot + identity + "Sign out"
 *  - Connected via env fallback → green dot + "env fallback" hint, "Sign in"
 *    button to upgrade
 *  - Disconnected → warning card + "Sign in" (gated on encryption key)
 *  - Stale row whose key fingerprint doesn't match → amber alert
 */
import { useState } from 'react';
import { AlertTriangle, KeyRound, LogIn, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { apiErrorMessage } from '@/api/client';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { useDeleteTelegramAccount, useTelegramAccount } from '@/hooks/useTelegramAccount';
import { TelegramLoginSheet } from './TelegramLoginSheet';

export function TelegramAccountSection() {
  const acc = useTelegramAccount();
  const sys = useSystemStatus();
  const del = useDeleteTelegramAccount();
  const toast = useToast();
  const [loginOpen, setLoginOpen] = useState(false);

  const tg = sys.data?.telegram;
  const account = acc.data;

  if (acc.isPending || sys.isPending) {
    return (
      <div className="rounded-[var(--radius)] border border-border bg-surface p-3.5 flex items-center gap-2.5">
        <Spinner size={12} />
        <span className="text-[13px] text-text-muted">Loading…</span>
      </div>
    );
  }

  // Resolve the user-facing variant. Order matters: a key mismatch is
  // surfaced even when the env-fallback is keeping us connected, because
  // it's the most actionable signal.
  if (account?.keyFingerprintMismatch) {
    return (
      <>
        <div
          role="alert"
          className="rounded-[var(--radius)] border border-warning/40 bg-warning-soft text-warning p-3.5 flex items-start gap-2.5"
        >
          <KeyRound size={14} strokeWidth={2.2} className="flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="text-[13px] font-medium">Stored account uses a different key</span>
            <span className="text-[12px] leading-relaxed break-words">
              The Telegram account in the database was encrypted with a different
              <code className="px-1 mx-0.5 rounded bg-warning/15 font-mono text-[11.5px]">
                TG_SESSION_ENCRYPTION_KEY
              </code>
              . The app is using
              {tg?.state === 'connected'
                ? ' the env fallback.'
                : ' degraded mode until you fix this.'}{' '}
              Restore the original key, or sign out and sign in again.
            </span>
            <div className="flex gap-1.5 mt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  del.mutate(undefined, {
                    onSuccess: () => toast.show('Stored account removed'),
                    onError: (err) => toast.show(apiErrorMessage(err, 'Failed to remove')),
                  })
                }
                disabled={del.isPending}
              >
                {del.isPending ? <Spinner size={12} /> : <LogOut size={12} />}
                Sign out
              </Button>
            </div>
          </div>
        </div>
        <TelegramLoginSheet open={loginOpen} onClose={() => setLoginOpen(false)} />
      </>
    );
  }

  if (tg?.state === 'connecting') {
    return (
      <div className="rounded-[var(--radius)] border border-border bg-surface p-3.5 flex items-center gap-2.5">
        <Spinner size={12} />
        <span className="text-[13px] text-text-muted">Connecting to Telegram…</span>
      </div>
    );
  }

  if (tg?.state === 'connected' && account?.source === 'db') {
    return (
      <>
        <div className="rounded-[var(--radius)] border border-border bg-surface p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-block w-2 h-2 rounded-full bg-success flex-shrink-0"
              aria-hidden
            />
            <div className="flex flex-col flex-1 min-w-0 gap-px">
              <span className="text-[13px] font-medium tracking-tight truncate">
                {account.displayName ?? 'Signed in'}
              </span>
              <span className="text-[11.5px] text-text-muted truncate">
                {[account.username ? `@${account.username}` : null, account.phoneNumber]
                  .filter(Boolean)
                  .join(' · ') || 'Telegram connected'}
              </span>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                del.mutate(undefined, {
                  onSuccess: () => toast.show('Signed out'),
                  onError: (err) => toast.show(apiErrorMessage(err, 'Sign out failed')),
                })
              }
              disabled={del.isPending}
            >
              {del.isPending ? <Spinner size={12} /> : <LogOut size={12} />}
              Sign out
            </Button>
          </div>
        </div>
        <TelegramLoginSheet open={loginOpen} onClose={() => setLoginOpen(false)} />
      </>
    );
  }

  if (tg?.state === 'connected' && account?.source === 'env') {
    return (
      <>
        <div className="rounded-[var(--radius)] border border-border bg-surface p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-block w-2 h-2 rounded-full bg-success flex-shrink-0"
              aria-hidden
            />
            <div className="flex flex-col flex-1 min-w-0 gap-px">
              <span className="text-[13px] font-medium tracking-tight">Telegram connected</span>
              <span className="text-[11.5px] text-text-muted">
                Using <code className="font-mono">TG_SESSION_STRING</code> from .env. Sign in to
                store the session in the database instead.
              </span>
            </div>
          </div>
          <div className="flex justify-end">
            <SignInButton
              encryptionKeyConfigured={account.encryptionKeyConfigured}
              onClick={() => setLoginOpen(true)}
              label="Sign in"
            />
          </div>
        </div>
        <TelegramLoginSheet open={loginOpen} onClose={() => setLoginOpen(false)} />
      </>
    );
  }

  // Disconnected (state='disconnected' or status missing).
  return (
    <>
      <div
        role="alert"
        className="rounded-[var(--radius)] border border-warning/40 bg-warning-soft text-warning p-3.5 flex flex-col gap-2.5"
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={14} strokeWidth={2.2} className="flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="text-[13px] font-medium">Telegram disconnected</span>
            <span className="text-[12px] leading-relaxed break-words">
              {tg?.reason ?? 'Telegram client is not available.'}
            </span>
            <span className="text-[11.5px] opacity-80">
              Subscribing and forwarding are unavailable until this is resolved.
            </span>
          </div>
        </div>
        <div className="flex justify-end">
          <SignInButton
            encryptionKeyConfigured={account?.encryptionKeyConfigured ?? false}
            onClick={() => setLoginOpen(true)}
            label="Sign in"
          />
        </div>
      </div>
      <TelegramLoginSheet open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}

function SignInButton({
  encryptionKeyConfigured,
  onClick,
  label,
}: {
  encryptionKeyConfigured: boolean;
  onClick: () => void;
  label: string;
}) {
  if (!encryptionKeyConfigured) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-text-muted">
          Set <code className="font-mono">TG_SESSION_ENCRYPTION_KEY</code> in .env to enable.
        </span>
        <Button variant="secondary" size="sm" disabled>
          <LogIn size={13} />
          {label}
        </Button>
      </div>
    );
  }
  return (
    <Button variant="primary" size="sm" onClick={onClick}>
      <LogIn size={13} />
      {label}
    </Button>
  );
}
