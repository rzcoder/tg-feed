import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { renderWithProviders } from '@/test/utils';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

const SYSTEM_STATUS_CONNECTED = {
  telegram: { state: 'connected', connected: true },
};
const DEFAULT_SETTINGS = { delayMs: 8000, albumDebounceMs: 2000 };
// Default account info so TelegramAccountSection doesn't render its own
// alert and pollute the alert role queries other tests rely on.
const ACCOUNT_ENV_CONNECTED = {
  present: true,
  source: 'env',
  displayName: null,
  username: null,
  phoneNumber: null,
  telegramUserId: null,
  encryptionKeyConfigured: false,
  keyFingerprintMismatch: false,
};
const ACCOUNT_DISCONNECTED = {
  present: false,
  source: null,
  displayName: null,
  username: null,
  phoneNumber: null,
  telegramUserId: null,
  encryptionKeyConfigured: false,
  keyFingerprintMismatch: false,
};
// The Bot card pulls /api/config/bot; a running env-config bot keeps it out of
// its error/loading state so the digest controls render.
const BOT_CONFIG = {
  tokenConfigured: true,
  tokenSource: 'env',
  encryptionKeyConfigured: true,
  keyFingerprintMismatch: false,
  admins: [{ id: '111', displayName: null, username: null }],
  adminsSource: 'env',
  publicUrl: null,
  publicUrlSource: null,
  botRunning: true,
};

/** The enabled "Save" button (the page has one per editable card). */
function enabledSaveButton(): HTMLButtonElement | undefined {
  return screen
    .getAllByRole('button', { name: /save/i })
    .find((b) => !(b as HTMLButtonElement).disabled) as HTMLButtonElement | undefined;
}

describe('SettingsPage', () => {
  it('loads delay and renders the value in the input', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(((path: string) => {
      if (path === '/api/settings') return Promise.resolve(json(200, DEFAULT_SETTINGS));
      if (path === '/api/system/status') return Promise.resolve(json(200, SYSTEM_STATUS_CONNECTED));
      if (path === '/api/tg/account') return Promise.resolve(json(200, ACCOUNT_ENV_CONNECTED));
      if (path === '/api/config/bot') return Promise.resolve(json(200, BOT_CONFIG));
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(<SettingsPage />);

    const input = await screen.findByLabelText(/global forward delay/i);
    expect(input).toHaveValue(8000);
  });

  it('shows the spam-classifier warning when delay drops below 4000ms', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(((path: string) => {
      if (path === '/api/settings') return Promise.resolve(json(200, DEFAULT_SETTINGS));
      if (path === '/api/system/status') return Promise.resolve(json(200, SYSTEM_STATUS_CONNECTED));
      if (path === '/api/tg/account') return Promise.resolve(json(200, ACCOUNT_ENV_CONNECTED));
      if (path === '/api/config/bot') return Promise.resolve(json(200, BOT_CONFIG));
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(<SettingsPage />);
    const input = await screen.findByLabelText(/global forward delay/i);
    await userEvent.clear(input);
    await userEvent.type(input, '3000');

    expect(await screen.findByRole('alert')).toHaveTextContent(/spam classifier/i);
  });

  it('saves the new delay via PUT (sending only the changed knob)', async () => {
    let putCalledWith: unknown = null;
    vi.spyOn(global, 'fetch').mockImplementation(((path: string, init?: RequestInit) => {
      if (path === '/api/settings' && (!init || init.method !== 'PUT')) {
        return Promise.resolve(json(200, DEFAULT_SETTINGS));
      }
      if (path === '/api/settings' && init?.method === 'PUT') {
        putCalledWith = JSON.parse(String(init.body));
        return Promise.resolve(json(200, { delayMs: 6000, albumDebounceMs: 2000 }));
      }
      if (path === '/api/system/status') return Promise.resolve(json(200, SYSTEM_STATUS_CONNECTED));
      if (path === '/api/tg/account') return Promise.resolve(json(200, ACCOUNT_ENV_CONNECTED));
      if (path === '/api/config/bot') return Promise.resolve(json(200, BOT_CONFIG));
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(<SettingsPage />);
    const input = await screen.findByLabelText(/global forward delay/i);
    await userEvent.clear(input);
    await userEvent.type(input, '6000');
    await userEvent.click(enabledSaveButton()!);

    // The album knob is unchanged, so the request body must not include it —
    // the server merges, but the client should still send a minimal payload.
    await waitFor(() => expect(putCalledWith).toEqual({ delayMs: 6000 }));
  });

  it('saves the album debounce knob alone when only it changed', async () => {
    let putCalledWith: unknown = null;
    vi.spyOn(global, 'fetch').mockImplementation(((path: string, init?: RequestInit) => {
      if (path === '/api/settings' && (!init || init.method !== 'PUT')) {
        return Promise.resolve(json(200, DEFAULT_SETTINGS));
      }
      if (path === '/api/settings' && init?.method === 'PUT') {
        putCalledWith = JSON.parse(String(init.body));
        return Promise.resolve(json(200, { delayMs: 8000, albumDebounceMs: 3500 }));
      }
      if (path === '/api/system/status') return Promise.resolve(json(200, SYSTEM_STATUS_CONNECTED));
      if (path === '/api/tg/account') return Promise.resolve(json(200, ACCOUNT_ENV_CONNECTED));
      if (path === '/api/config/bot') return Promise.resolve(json(200, BOT_CONFIG));
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(<SettingsPage />);
    const input = await screen.findByLabelText(/album debounce window/i);
    await userEvent.clear(input);
    await userEvent.type(input, '3500');
    await userEvent.click(enabledSaveButton()!);

    await waitFor(() => expect(putCalledWith).toEqual({ albumDebounceMs: 3500 }));
  });

  it('renders the disconnected warning when telegram is unavailable', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(((path: string) => {
      if (path === '/api/settings') return Promise.resolve(json(200, DEFAULT_SETTINGS));
      if (path === '/api/system/status') {
        return Promise.resolve(
          json(200, {
            telegram: {
              state: 'disconnected',
              connected: false,
              reason: 'Missing required Telegram env vars: TG_SESSION_STRING.',
            },
          }),
        );
      }
      if (path === '/api/tg/account') return Promise.resolve(json(200, ACCOUNT_DISCONNECTED));
      if (path === '/api/config/bot') return Promise.resolve(json(200, BOT_CONFIG));
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText(/telegram disconnected/i)).toBeInTheDocument();
    expect(screen.getByText(/missing required telegram env vars/i)).toBeInTheDocument();
  });

  it('reveals the day picker for weekly and saves only the changed digest fields', async () => {
    let putBody: unknown = null;
    vi.spyOn(global, 'fetch').mockImplementation(((path: string, init?: RequestInit) => {
      if (path === '/api/settings' && init?.method === 'PUT') {
        putBody = JSON.parse(String(init.body));
        return Promise.resolve(json(200, { ...DEFAULT_SETTINGS, statsDigestEnabled: true }));
      }
      if (path === '/api/settings') return Promise.resolve(json(200, DEFAULT_SETTINGS));
      if (path === '/api/system/status') return Promise.resolve(json(200, SYSTEM_STATUS_CONNECTED));
      if (path === '/api/tg/account') return Promise.resolve(json(200, ACCOUNT_ENV_CONNECTED));
      if (path === '/api/config/bot') return Promise.resolve(json(200, BOT_CONFIG));
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(<SettingsPage />);

    const toggle = await screen.findByRole('switch', { name: /enable stats digest/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    // Day picker only exists for weekly; daily is the default → absent.
    expect(screen.queryByRole('combobox', { name: /day of week/i })).toBeNull();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /digest frequency/i }),
      'weekly',
    );
    expect(screen.getByRole('combobox', { name: /day of week/i })).toBeInTheDocument();

    await userEvent.click(enabledSaveButton()!);

    await waitFor(() => expect(putBody).not.toBeNull());
    const body = putBody as Record<string, unknown>;
    expect(body.statsDigestEnabled).toBe(true);
    expect(body.statsDigestFrequency).toBe('weekly');
    // Untouched throttle knobs must not be sent.
    expect(body.delayMs).toBeUndefined();
    expect(body.albumDebounceMs).toBeUndefined();
  });

  it('saves bot connection params through the unified Save', async () => {
    let botPut: unknown = null;
    vi.spyOn(global, 'fetch').mockImplementation(((path: string, init?: RequestInit) => {
      if (path === '/api/config/bot' && init?.method === 'PUT') {
        botPut = JSON.parse(String(init.body));
        return Promise.resolve(json(200, { ...BOT_CONFIG, publicUrl: 'https://x.example' }));
      }
      if (path === '/api/config/bot') return Promise.resolve(json(200, BOT_CONFIG));
      if (path === '/api/settings') return Promise.resolve(json(200, DEFAULT_SETTINGS));
      if (path === '/api/system/status') return Promise.resolve(json(200, SYSTEM_STATUS_CONNECTED));
      if (path === '/api/tg/account') return Promise.resolve(json(200, ACCOUNT_ENV_CONNECTED));
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(<SettingsPage />);

    const url = await screen.findByPlaceholderText('https://tg-feed.example.com');
    await userEvent.type(url, 'https://x.example');
    await userEvent.click(enabledSaveButton()!);

    await waitFor(() => expect(botPut).not.toBeNull());
    expect((botPut as Record<string, unknown>).publicUrl).toBe('https://x.example');
  });
});
