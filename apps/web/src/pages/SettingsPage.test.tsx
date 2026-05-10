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

const SYSTEM_STATUS_CONNECTED = { telegram: { connected: true } };

describe('SettingsPage', () => {
  it('loads delay and renders the value in the input', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(((path: string) => {
      if (path === '/api/settings') return Promise.resolve(json(200, { delayMs: 8000 }));
      if (path === '/api/system/status') return Promise.resolve(json(200, SYSTEM_STATUS_CONNECTED));
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(<SettingsPage />);

    const input = await screen.findByLabelText(/global forward delay/i);
    expect(input).toHaveValue(8000);
  });

  it('shows the spam-classifier warning when delay drops below 4000ms', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(((path: string) => {
      if (path === '/api/settings') return Promise.resolve(json(200, { delayMs: 8000 }));
      if (path === '/api/system/status') return Promise.resolve(json(200, SYSTEM_STATUS_CONNECTED));
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(<SettingsPage />);
    const input = await screen.findByLabelText(/global forward delay/i);
    await userEvent.clear(input);
    await userEvent.type(input, '3000');

    expect(await screen.findByRole('alert')).toHaveTextContent(/spam classifier/i);
  });

  it('saves the new delay via PUT', async () => {
    let putCalledWith: unknown = null;
    vi.spyOn(global, 'fetch').mockImplementation(((path: string, init?: RequestInit) => {
      if (path === '/api/settings' && (!init || init.method !== 'PUT')) {
        return Promise.resolve(json(200, { delayMs: 8000 }));
      }
      if (path === '/api/settings' && init?.method === 'PUT') {
        putCalledWith = JSON.parse(String(init.body));
        return Promise.resolve(json(200, { delayMs: 6000 }));
      }
      if (path === '/api/system/status') return Promise.resolve(json(200, SYSTEM_STATUS_CONNECTED));
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(<SettingsPage />);
    const input = await screen.findByLabelText(/global forward delay/i);
    await userEvent.clear(input);
    await userEvent.type(input, '6000');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(putCalledWith).toEqual({ delayMs: 6000 }));
  });

  it('renders the disconnected warning when telegram is unavailable', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(((path: string) => {
      if (path === '/api/settings') return Promise.resolve(json(200, { delayMs: 8000 }));
      if (path === '/api/system/status') {
        return Promise.resolve(
          json(200, {
            telegram: {
              connected: false,
              reason: 'Missing required Telegram env vars: TG_SESSION_STRING.',
            },
          }),
        );
      }
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText(/telegram disconnected/i)).toBeInTheDocument();
    expect(screen.getByText(/missing required telegram env vars/i)).toBeInTheDocument();
  });
});
