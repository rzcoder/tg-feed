import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { SubscriptionsPage } from './SubscriptionsPage';
import { renderWithProviders } from '@/test/utils';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchMock(impl: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(global, 'fetch').mockImplementation(((path: string, init?: RequestInit) => {
    return Promise.resolve(impl(path, init));
  }) as unknown as typeof fetch);
}

const sub = {
  id: 1,
  sourceChatId: '-1001234567890',
  sourceTitle: 'Anthropic',
  handle: '@anthropic_ai',
  destinationId: 1,
  destinationName: 'ops',
  destinationChatId: '-1009999999999',
  enabled: true,
  filterCount: 2,
  forwardedCount: 42,
  libraryFilterIds: [],
  createdAt: '2026-01-01T00:00:00Z',
};

const destination = {
  id: 1,
  name: 'ops',
  chatId: '-1009999999999',
  note: null,
  usageCount: 1,
  createdAt: '2026-01-01T00:00:00Z',
};

afterEach(() => vi.restoreAllMocks());

describe('SubscriptionsPage', () => {
  it('renders subscription rows with destination name', async () => {
    fetchMock((path) => {
      if (path === '/api/subscriptions') return json(200, { items: [sub] });
      if (path === '/api/destinations') return json(200, { items: [destination] });
      return json(404, { error: { code: 'not_found', message: '' } });
    });

    renderWithProviders(<SubscriptionsPage />);

    expect(await screen.findByText('Anthropic')).toBeInTheDocument();
    // Both row meta and (after expand) stat-chip render 'ops'; check at least one.
    expect(screen.getAllByText('ops').length).toBeGreaterThan(0);
    expect(screen.getByText('2 filters')).toBeInTheDocument();
  });

  it('expands inline on row tap and shows action buttons', async () => {
    fetchMock((path) => {
      if (path === '/api/subscriptions') return json(200, { items: [sub] });
      if (path === '/api/destinations') return json(200, { items: [destination] });
      return json(404, { error: { code: 'not_found', message: '' } });
    });

    renderWithProviders(<SubscriptionsPage />);

    const row = await screen.findByText('Anthropic');
    await userEvent.click(row);

    // Use exact match — the SubRow itself is a button whose accessible name
    // includes "1 filter" / "2 filters", which would also match /filters/i.
    expect(await screen.findByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^filters$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
    // Stat chip showing forwarded count.
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('opens the add sheet when Add is clicked and lists destinations', async () => {
    fetchMock((path) => {
      if (path === '/api/subscriptions') return json(200, { items: [] });
      if (path === '/api/destinations') return json(200, { items: [destination] });
      return json(404, { error: { code: 'not_found', message: '' } });
    });

    renderWithProviders(<SubscriptionsPage />);

    const addBtns = await screen.findAllByRole('button', { name: /add/i });
    await userEvent.click(addBtns[0]!);

    await waitFor(() => expect(screen.getByLabelText('Source channel')).toBeInTheDocument());
    // Destination radio with the seeded destination's name should appear.
    expect(screen.getAllByText('ops').length).toBeGreaterThan(0);
  });

  it('PATCH from edit sheet includes a newly-added inline filter in the body', async () => {
    let captured: { method: string; body: unknown } | null = null;
    fetchMock((path, init) => {
      if (
        path === '/api/subscriptions' &&
        (!init || init.method === undefined || init.method === 'GET')
      ) {
        return json(200, { items: [sub] });
      }
      if (path === '/api/destinations') return json(200, { items: [destination] });
      if (path === '/api/library-filters') return json(200, { items: [] });
      if (path === '/api/filters/catalog') {
        return json(200, {
          items: [
            { type: 'text-contains', label: 'Text contains' },
            { type: 'min-length', label: 'Minimum length' },
          ],
        });
      }
      if (path === `/api/subscriptions/${sub.id}/filters`) {
        return json(200, { items: [] });
      }
      if (path === `/api/subscriptions/${sub.id}` && init?.method === 'PATCH') {
        captured = { method: 'PATCH', body: JSON.parse((init.body as string) ?? '{}') };
        return json(200, sub);
      }
      return json(404, { error: { code: 'not_found', message: '' } });
    });

    renderWithProviders(<SubscriptionsPage />);

    // Expand the row, then click Edit.
    const row = await screen.findByText('Anthropic');
    await userEvent.click(row);
    await userEvent.click(await screen.findByRole('button', { name: /^edit$/i }));

    // Sheet open → click the "Add" button next to "Custom filters".
    const customSection = await screen.findByText(/Custom filters/i);
    const addCustomBtn = customSection.closest('div')!.parentElement!.querySelector('button')!;
    await userEvent.click(addCustomBtn);

    // Pick the text-contains rule.
    await userEvent.click(await screen.findByText('Text contains'));

    // Fill in the substring.
    const input = await screen.findByLabelText('Substring');
    await userEvent.type(input, 'release');

    // Commit the draft.
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    // Submit the sheet via Save.
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.method).toBe('PATCH');
    const body = captured!.body as {
      inlineFilters: { ruleType: string; params: { value: string } }[];
    };
    expect(body.inlineFilters).toHaveLength(1);
    expect(body.inlineFilters[0]!.ruleType).toBe('text-contains');
    expect(body.inlineFilters[0]!.params.value).toBe('release');
  });
});
