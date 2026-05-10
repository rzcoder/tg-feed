/**
 * ActivityPage smoke tests — hydrate from forward-log, render rows.
 *
 * SSE behaviour is covered indirectly: we mock EventSource as a no-op
 * (jsdom doesn't ship it), assert that hydration renders, and skip live
 * append since wiring a fake EventSource through to setEvents is more
 * work than the assurance is worth at this layer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { ActivityPage } from './ActivityPage';
import { StreamProvider } from '@/hooks/useActivityStream';
import { SUBSCRIPTIONS_KEY } from '@/hooks/useSubscriptions';
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
  // Last constructed instance — tests dispatch through it.
  static current: FakeEventSource | null = null;
  readyState = FakeEventSource.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  constructor() {
    FakeEventSource.current = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, data: unknown) {
    const fns = this.listeners.get(type);
    if (!fns) return;
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of fns) fn(ev);
  }
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

  // Regression: invalidating the `subscriptions` query (e.g. after a
  // `subscription.changed` SSE event) used to rebuild the prepend effect's
  // memoized lookup maps, which were in its dep array, which re-prepended
  // the same `stream.lastEvent` and produced N rows for one logical event.
  it('does not duplicate a live event when subscriptions data refetches', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(((path: string) => {
      if (path === '/api/subscriptions') {
        return Promise.resolve(
          json(200, {
            items: [
              {
                id: 1,
                sourceChatId: '1001',
                sourceTitle: 'Source',
                handle: '@source',
                iconDataUrl: null,
                destinationId: 1,
                destinationName: 'Dest',
                destinationChatId: '2002',
                enabled: true,
                filterCount: 0,
                forwardedCount: 0,
                libraryFilterIds: [],
                forwardingRestrictedAt: null,
                sourceAccessStatus: 'ok',
                sourceAccessCheckedAt: null,
                destinationAccessStatus: 'ok',
                createdAt: new Date().toISOString(),
              },
            ],
          }),
        );
      }
      if (path === '/api/destinations') return Promise.resolve(json(200, { items: [] }));
      if (path.startsWith('/api/forward-log')) {
        return Promise.resolve(json(200, { items: [], nextOffset: null }));
      }
      return Promise.resolve(json(404, { error: { code: 'not_found', message: '' } }));
    }) as unknown as typeof fetch);

    const { client } = renderWithProviders(
      <StreamProvider>
        <ActivityPage />
      </StreamProvider>,
    );

    // Wait for initial subscriptions/destinations to land so the prepend
    // effect's deps have stabilized once (under the old code this would
    // already be a re-run trigger).
    await waitFor(() => expect(client.getQueryData(SUBSCRIPTIONS_KEY)).toBeDefined());
    await screen.findByText(/Waiting for activity/i);

    // One logical SSE event arrives.
    await act(async () => {
      FakeEventSource.current!.dispatch('forward.completed', {
        type: 'forward.completed',
        subscriptionId: 1,
        sourceChatId: '1001',
        destinationChatId: '2002',
        sourceMessageIds: ['500'],
        destMessageIds: ['999'],
        occurredAt: new Date().toISOString(),
      });
    });

    expect(await screen.findAllByText('Source')).toHaveLength(1);

    // Force `useSubscriptions` to refetch — fresh `subs.data` reference,
    // fresh `subById` Map. Should NOT re-prepend the same SSE event.
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    });

    expect(screen.getAllByText('Source')).toHaveLength(1);
  });

  // Regression: hydrated rows from /api/forward-log come back with
  // `subscriptionTitle` already filled (server LEFT JOINs subscriptions),
  // but `sourceHandle` and `destinationLabel` null — they need backfill
  // from the subscriptions/destinations queries. The old gate only
  // triggered enrichment when `subscriptionTitle` was null, so on restart
  // historical rows rendered with `—` for from/to.
  it('backfills sourceHandle and destinationLabel for hydrated rows', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(((path: string) => {
      if (path === '/api/subscriptions') {
        return Promise.resolve(
          json(200, {
            items: [
              {
                id: 7,
                sourceChatId: '1001',
                sourceTitle: 'FeedTest',
                handle: '@feedtest',
                iconDataUrl: null,
                destinationId: 1,
                destinationName: 'My Dest',
                destinationChatId: '2002',
                enabled: true,
                filterCount: 0,
                forwardedCount: 0,
                libraryFilterIds: [],
                forwardingRestrictedAt: null,
                sourceAccessStatus: 'ok',
                sourceAccessCheckedAt: null,
                destinationAccessStatus: 'ok',
                createdAt: new Date().toISOString(),
              },
            ],
          }),
        );
      }
      if (path === '/api/destinations') return Promise.resolve(json(200, { items: [] }));
      if (path.startsWith('/api/forward-log')) {
        return Promise.resolve(
          json(200, {
            items: [
              {
                id: 1,
                subscriptionId: 7,
                subscriptionTitle: 'FeedTest',
                sourceMessageId: '500',
                destMessageId: '999',
                status: 'sent',
                error: null,
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

    expect(await screen.findByText('@feedtest')).toBeInTheDocument();
    expect(screen.getByText('My Dest')).toBeInTheDocument();
  });
});
