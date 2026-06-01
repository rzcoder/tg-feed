import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { DestinationsPage } from './DestinationsPage';
import { renderWithProviders } from '@/test/utils';

function jsonResponse(status: number, body: unknown): Response {
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

afterEach(() => vi.restoreAllMocks());

describe('DestinationsPage', () => {
  it('renders rows with usage count', async () => {
    fetchMock((path) => {
      if (path === '/api/destinations') {
        return jsonResponse(200, {
          items: [
            {
              id: 1,
              name: 'ops',
              chatId: '-1009999999999',
              note: null,
              topicId: null,
              topicTitle: null,
              iconDataUrl: null,
              usageCount: 2,
              accessStatus: 'ok',
              accessCheckedAt: null,
              createdAt: '2026-01-01T00:00:00Z',
            },
            {
              id: 2,
              name: 'logs',
              chatId: '-1008888888888',
              note: null,
              topicId: null,
              topicTitle: null,
              iconDataUrl: null,
              usageCount: 0,
              accessStatus: 'ok',
              accessCheckedAt: null,
              createdAt: '2026-01-02T00:00:00Z',
            },
          ],
        });
      }
      return jsonResponse(404, { error: { code: 'not_found', message: '' } });
    });

    renderWithProviders(<DestinationsPage />);

    expect(await screen.findByText('ops')).toBeInTheDocument();
    expect(screen.getByText('logs')).toBeInTheDocument();
    expect(screen.getByText('2 subs')).toBeInTheDocument();
    expect(screen.getByText('0 subs')).toBeInTheDocument();
  });

  it('disables Delete when destination is in use', async () => {
    fetchMock((path) => {
      if (path === '/api/destinations') {
        return jsonResponse(200, {
          items: [
            {
              id: 1,
              name: 'ops',
              chatId: '-1009999999999',
              note: null,
              topicId: null,
              topicTitle: null,
              iconDataUrl: null,
              usageCount: 3,
              accessStatus: 'ok',
              accessCheckedAt: null,
              createdAt: '2026-01-01T00:00:00Z',
            },
          ],
        });
      }
      return jsonResponse(404, { error: { code: 'not_found', message: '' } });
    });

    renderWithProviders(<DestinationsPage />);

    const deleteBtn = await screen.findByRole('button', { name: /delete ops/i });
    expect(deleteBtn).toBeDisabled();
  });

  it('opens add sheet on Add click', async () => {
    fetchMock((path) => {
      if (path === '/api/destinations') return jsonResponse(200, { items: [] });
      return jsonResponse(404, { error: { code: 'not_found', message: '' } });
    });

    renderWithProviders(<DestinationsPage />);

    // Empty state has its own Add button — pick the section header one.
    const addBtns = await screen.findAllByRole('button', { name: /add/i });
    await userEvent.click(addBtns[0]!);

    // The sheet is identified by its Cancel button, which the empty state lacks.
    expect(await screen.findByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });
});
