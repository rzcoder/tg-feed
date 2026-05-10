/**
 * ActivityPage smoke tests — hydrate from forward-log, render rows.
 *
 * SSE behaviour is covered indirectly: we mock EventSource as a no-op
 * (jsdom doesn't ship it), assert that hydration renders, and skip live
 * append since wiring a fake EventSource through to setEvents is more
 * work than the assurance is worth at this layer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ActivityPage } from './ActivityPage';
import { StreamProvider } from '@/hooks/useActivityStream';
import { renderWithProviders } from '@/test/utils';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

beforeAll(() => {
  // jsdom doesn't have EventSource; the activity stream hook constructs
  // one on mount. Stub before any test renders the page.
  (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;
});

afterEach(() => vi.restoreAllMocks());

describe('ActivityPage', () => {
  it('hydrates from /api/forward-log and renders rows', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(((path: string) => {
      if (path === '/api/subscriptions') return Promise.resolve(json(200, { items: [] }));
      if (path === '/api/destinations') return Promise.resolve(json(200, { items: [] }));
      if (path.startsWith('/api/forward-log')) {
        return Promise.resolve(
          json(200, {
            items: [
              {
                id: 1,
                subscriptionId: 1,
                subscriptionTitle: 'Anthropic',
                sourceMessageId: '500',
                destMessageId: '999',
                status: 'sent',
                error: null,
                createdAt: new Date().toISOString(),
              },
              {
                id: 2,
                subscriptionId: 1,
                subscriptionTitle: 'Anthropic',
                sourceMessageId: '501',
                destMessageId: null,
                status: 'filtered',
                error: 'text-excludes: matched "show hn"',
                createdAt: new Date().toISOString(),
              },
            ],
            nextOffset: null,
          }),
        );
      }
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(
      <StreamProvider>
        <ActivityPage />
      </StreamProvider>,
    );

    expect(await screen.findAllByText('Anthropic')).toHaveLength(2);
    expect(screen.getByText(/text-excludes: matched/i)).toBeInTheDocument();
  });

  it('shows empty state when no events', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(((path: string) => {
      if (path === '/api/subscriptions') return Promise.resolve(json(200, { items: [] }));
      if (path === '/api/destinations') return Promise.resolve(json(200, { items: [] }));
      if (path.startsWith('/api/forward-log')) {
        return Promise.resolve(json(200, { items: [], nextOffset: null }));
      }
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    renderWithProviders(
      <StreamProvider>
        <ActivityPage />
      </StreamProvider>,
    );

    expect(await screen.findByText(/Waiting for activity/i)).toBeInTheDocument();
  });
});
