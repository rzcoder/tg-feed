/**
 * Settings → Telegram Account Connection card.
 *
 * The userbot (gramjs) account that does the forwarding. A status pill in the
 * header reflects the live Telegram connection; the body + footer switch on
 * state: sign in (phone-code or paste-session), sign out, env-fallback upgrade,
 * or a key-fingerprint-mismatch warning. Sign-in is gated on an encryption key.
 */
import { useState } from 'react';
import { AlertTriangle, KeyRound, type LucideIcon, LogIn, LogOut, Plug, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { apiErrorMessage } from '@/api/client';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { useDeleteTelegramAccount, useTelegramAccount } from '@/hooks/useTelegramAccount';
import { CardFooter, CardHeader, SettingsCard, StatusPill } from './primitives';
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
      <SettingsCard className="p-3.5 flex items-center gap-2.5">
        <Spinner size={12} />
        <span className="text-[13px] text-text-muted">Loading…</span>
      </SettingsCard>
    );
  }

  const signOut = () =>
    del.mutate(undefined, {
      onSuccess: () => toast.show('Signed out'),
      onError: (err) => toast.error(apiErrorMessage(err, 'Sign out failed')),
    });

  // Pick the status pill + body. Order matters: a key mismatch is the most
  // actionable signal even when the env fallback keeps us connected.
  let pill = <StatusPill tone="down">offline</StatusPill>;
  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (account?.keyFingerprintMismatch) {
    pill = <StatusPill tone="warn">key mismatch</StatusPill>;
    body = (
      <Banner icon={KeyRound} title="Stored account uses a different key">
        The Telegram account in the database was encrypted with a different{' '}
        <code className="px-1 rounded bg-warning/15 font-mono text-[11.5px]">
          TG_SESSION_ENCRYPTION_KEY
        </code>
        . The app is using {tg?.state === 'connected' ? 'the env fallback' : 'degraded mode'}.
        Restore the original key, or sign out and sign in again.
      </Banner>
    );
    footer = <SignOutButton onClick={signOut} pending={del.isPending} />;
  } else if (tg?.state === 'connecting') {
    pill = <StatusPill tone="warn">connecting</StatusPill>;
    body = (
      <div className="flex items-center gap-2.5 text-[13px] text-text-muted">
        <Spinner size={12} /> Connecting to Telegram…
      </div>
    );
  } else if (tg?.state === 'connected' && account?.source === 'db') {
    pill = <StatusPill tone="live">online</StatusPill>;
    body = (
      <div className="flex items-center gap-3 min-w-0">
        <AccountAvatar src={account.avatarDataUrl} />
        <div className="flex flex-col gap-px min-w-0">
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
    );
    footer = <SignOutButton onClick={signOut} pending={del.isPending} />;
  } else if (tg?.state === 'connected' && account?.source === 'env') {
    pill = <StatusPill tone="live">online</StatusPill>;
    body = (
      <div className="flex items-center gap-3">
        <AccountAvatar src={account.avatarDataUrl} />
        <span className="text-[12px] text-text-muted leading-relaxed">
          Using <code className="font-mono">TG_SESSION_STRING</code> from .env. Sign in to store the
          session in the database instead.
        </span>
      </div>
    );
    footer = (
      <SignInButton
        encryptionKeyConfigured={account.encryptionKeyConfigured}
        onClick={() => setLoginOpen(true)}
      />
    );
  } else {
    // Disconnected (state='disconnected' or status missing).
    body = (
      <Banner icon={AlertTriangle} title="Telegram disconnected">
        {tg?.reason ?? 'Telegram client is not available.'} Subscribing and forwarding are
        unavailable until this is resolved.
      </Banner>
    );
    footer = (
      <SignInButton
        encryptionKeyConfigured={account?.encryptionKeyConfigured ?? false}
        onClick={() => setLoginOpen(true)}
      />
    );
  }

  return (
    <>
      <SettingsCard>
        <CardHeader icon={<Plug size={14} />} title="Telegram Account Connection" right={pill} />
        <div className="p-4">{body}</div>
        {footer && <CardFooter>{footer}</CardFooter>}
      </SettingsCard>
      <TelegramLoginSheet open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}

interface AccountAvatarProps {
  src: string | null;
}

function AccountAvatar({ src }: AccountAvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="w-9 h-9 rounded-full object-cover border border-border flex-shrink-0"
      />
    );
  }
  return (
    <span className="grid place-items-center w-9 h-9 rounded-full bg-surface-2 border border-border text-text-2 flex-shrink-0">
      <User size={16} />
    </span>
  );
}

interface BannerProps {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}

function Banner({ icon: Icon, title, children }: BannerProps) {
  return (
    <div role="alert" className="flex items-start gap-2.5 text-warning">
      <Icon size={14} strokeWidth={2.2} className="flex-shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="text-[12px] leading-relaxed text-text-2 break-words">{children}</span>
      </div>
    </div>
  );
}

interface SignOutButtonProps {
  onClick: () => void;
  pending: boolean;
}

function SignOutButton({ onClick, pending }: SignOutButtonProps) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={pending}>
      {pending ? <Spinner size={12} /> : <LogOut size={12} />}
      Sign out
    </Button>
  );
}

interface SignInButtonProps {
  encryptionKeyConfigured: boolean;
  onClick: () => void;
}

function SignInButton({ encryptionKeyConfigured, onClick }: SignInButtonProps) {
  if (!encryptionKeyConfigured) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-text-muted">
          Set <code className="font-mono">TG_SESSION_ENCRYPTION_KEY</code> in .env to enable.
        </span>
        <Button variant="secondary" size="sm" disabled>
          <LogIn size={13} />
          Sign in
        </Button>
      </div>
    );
  }
  return (
    <Button variant="primary" size="sm" onClick={onClick}>
      <LogIn size={13} />
      Sign in
    </Button>
  );
}
