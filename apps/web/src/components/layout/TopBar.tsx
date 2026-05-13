import { LogoBadge } from '@/components/domain/Logo';
import { ThemePicker } from '@/components/domain/ThemePicker';
import { ConnectionPill, type ConnectionState } from '@/components/domain/ConnectionPill';
import { useConnectionState } from '@/hooks/useActivityStream';

export function TopBar({ title }: { title: string }) {
  const state = useConnectionState();

  return (
    <header
      className="flex items-center justify-between h-[52px] flex-shrink-0 px-4 border-b border-border bg-bg z-10 relative"
      role="banner"
    >
      <div className="flex items-center gap-2">
        <LogoBadge />
        <div className="flex flex-col leading-tight">
          <span className="text-[14.5px] font-semibold tracking-tight">{title}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ConnectionPillButton state={state} />
        <ThemePicker />
      </div>
    </header>
  );
}

function ConnectionPillButton({ state }: { state: ConnectionState }) {
  // Render the pill as a non-interactive indicator. Future chapters could
  // make it clickable to retry the SSE connection.
  return <ConnectionPill state={state} />;
}
