import { Spinner } from '@/components/ui/spinner';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { BotSettingsCard } from '@/components/settings/BotSettingsCard';
import { DataSection } from '@/components/settings/DataSection';
import { ForwardingSection } from '@/components/settings/ForwardingSection';
import { TelegramAccountSection } from '@/components/settings/TelegramAccountSection';
import { useSettings } from '@/hooks/useSettings';

export function SettingsPage() {
  const { isPending } = useSettings();

  if (isPending) {
    return (
      <div className="grid place-items-center flex-1 text-text-muted">
        <Spinner />
      </div>
    );
  }

  // Each panel is a self-titled card (header carries its own title + status),
  // stacked in a centered column.
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="scroll flex-1 min-h-0 px-4.5 pt-4 pb-6">
        <div className="flex flex-col gap-3 max-w-[640px] mx-auto">
          <TelegramAccountSection />
          <BotSettingsCard />
          <ForwardingSection />
          <AppearanceSection />
          <DataSection />
        </div>
      </div>
    </div>
  );
}
