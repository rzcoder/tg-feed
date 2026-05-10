import { type ReactElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithProvidersOptions {
  client?: QueryClient;
  initialEntries?: string[];
}

export type RenderWithProvidersResult = RenderResult & { client: QueryClient };

export function renderWithProviders(
  ui: ReactElement,
  { client = makeQueryClient(), initialEntries = ['/'] }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
  }
  const result = render(ui, { wrapper: Wrapper });
  return Object.assign(result, { client });
}
