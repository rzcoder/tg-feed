import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { renderWithProviders } from '@/test/utils';

function fetchMock(impl: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.spyOn(global, 'fetch').mockImplementation(((path: string, init: RequestInit) => {
    return Promise.resolve(impl(path, init));
  }) as unknown as typeof fetch);
  return spy;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginPage', () => {
  it('shows the login form when /me returns 401', async () => {
    fetchMock((path) => {
      if (path === '/api/me')
        return jsonResponse(401, { error: { code: 'unauthorized', message: 'no' } });
      return jsonResponse(404, { error: { code: 'not_found', message: '' } });
    });

    renderWithProviders(<LoginPage />, { initialEntries: ['/login'] });
    expect(await screen.findByRole('button', { name: /unlock/i })).toBeInTheDocument();
  });

  it('redirects to / on successful login', async () => {
    let mePosted = false;
    fetchMock((path, init) => {
      if (path === '/api/me') {
        return mePosted
          ? jsonResponse(200, { authenticated: true })
          : jsonResponse(401, { error: { code: 'unauthorized', message: 'no' } });
      }
      if (path === '/api/auth/login' && init.method === 'POST') {
        mePosted = true;
        return jsonResponse(200, { authenticated: true });
      }
      return jsonResponse(404, { error: { code: 'not_found', message: '' } });
    });

    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>,
      { initialEntries: ['/login'] },
    );

    await screen.findByRole('button', { name: /unlock/i });
    await userEvent.type(screen.getByLabelText('Password'), 'letmein');
    await userEvent.click(screen.getByRole('button', { name: /unlock/i }));

    expect(await screen.findByText('home')).toBeInTheDocument();
  });

  it('shows "Wrong password." on 401', async () => {
    fetchMock((path) => {
      if (path === '/api/me')
        return jsonResponse(401, { error: { code: 'unauthorized', message: 'no' } });
      if (path === '/api/auth/login') {
        return jsonResponse(401, { error: { code: 'unauthorized', message: 'invalid password' } });
      }
      return jsonResponse(404, { error: { code: 'not_found', message: '' } });
    });

    renderWithProviders(<LoginPage />, { initialEntries: ['/login'] });
    await screen.findByRole('button', { name: /unlock/i });
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/wrong password/i));
  });
});
