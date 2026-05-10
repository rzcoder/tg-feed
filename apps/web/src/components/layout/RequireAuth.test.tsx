import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from './RequireAuth';
import { renderWithProviders } from '@/test/utils';

function fetchMock(impl: (path: string) => Response | Promise<Response>) {
  return vi.spyOn(global, 'fetch').mockImplementation(((path: string) => {
    return Promise.resolve(impl(path));
  }) as unknown as typeof fetch);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('RequireAuth', () => {
  it('renders children when /me returns 200', async () => {
    fetchMock(() => json(200, { authenticated: true }));
    renderWithProviders(
      <RequireAuth>
        <div>protected</div>
      </RequireAuth>,
    );
    expect(await screen.findByText('protected')).toBeInTheDocument();
  });

  it('redirects to /login when /me returns 401', async () => {
    fetchMock((path) => {
      if (path === '/api/me') return json(401, { error: { code: 'unauthorized', message: 'no' } });
      return json(404, {});
    });

    renderWithProviders(
      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth>
              <div>protected</div>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<div>login screen</div>} />
      </Routes>,
    );

    expect(await screen.findByText('login screen')).toBeInTheDocument();
  });
});
