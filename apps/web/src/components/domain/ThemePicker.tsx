import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/lib/useTheme';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

export function ThemePicker() {
  const { preference, resolved, setPreference } = useTheme();

  // Trigger icon reflects what's actually painted (resolved), not the
  // preference, so the user sees the current visual state.
  const TriggerIcon = resolved === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Theme: ${preference}`}
          title={`Theme: ${preference}`}
        >
          <TriggerIcon className="h-[15px] w-[15px]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            selected={preference === value}
            onSelect={() => setPreference(value)}
          >
            <span className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
