/**
 * Settings → Appearance card. Theme preference (system / light / dark);
 * applies instantly, so there's no Save / Reset footer.
 */
import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useThemeContext } from '@/lib/ThemeProvider';
import { type ThemePreference } from '@/lib/useTheme';
import { cn } from '@/lib/cn';
import { CardHeader, SettingsCard } from './primitives';

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

export function AppearanceSection() {
  const { preference, setPreference } = useThemeContext();
  return (
    <SettingsCard>
      <CardHeader icon={<Palette size={14} />} title="Appearance" />
      <div className="p-4">
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Theme">
          {THEME_OPTIONS.map(({ value, label, Icon }) => {
            const active = preference === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setPreference(value)}
                aria-pressed={active}
                className={cn(
                  'flex items-center justify-center gap-1.5 h-9 rounded-lg border text-[13px] font-medium',
                  'transition-colors duration-100',
                  active
                    ? 'bg-accent-soft text-accent border-accent/35'
                    : 'bg-surface-2 text-text-2 border-border hover:bg-surface-3',
                )}
              >
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </SettingsCard>
  );
}
