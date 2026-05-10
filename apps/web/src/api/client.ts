/**
 * Tiny fetch wrapper for the JSON API.
 *
 * - Always sends the session cookie (`credentials: 'include'`).
 * - Parses JSON responses and returns the typed body, or throws an
 *   `ApiError` carrying the parsed `ErrorResponse` envelope.
 * - On 401 from any authed call, redirects to /login. The redirect is
 *   global (location.assign) so React Router doesn't have to be in scope.
 *   We skip the redirect for the auth routes themselves so the LoginPage
 *   can show its own error message.
 */
import { errorResponseSchema, type ErrorResponse } from '@tg-feed/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorResponse | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get code(): string | undefined {
    return this.body?.error.code;
  }
}

export class UnauthorizedError extends ApiError {
  constructor(status: number, body: ErrorResponse | undefined, message: string) {
    super(status, body, message);
    this.name = 'UnauthorizedError';
  }
}

export interface RequestInitJson<TBody> extends Omit<RequestInit, 'body'> {
  body?: TBody;
  /** When true, suppress the global 401 → /login redirect. Use for auth routes. */
  silent401?: boolean;
}

const AUTH_ROUTES = new Set(['/api/auth/login', '/api/auth/logout', '/api/me']);

export async function apiFetch<TResponse, TBody = unknown>(
  path: string,
  init: RequestInitJson<TBody> = {},
): Promise<TResponse> {
  const { body, headers, silent401, ...rest } = init;
  const isJson = body !== undefined;

  const res = await fetch(path, {
    ...rest,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(isJson ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    const parsed = await safeParseError(res);
    if (!silent401 && !AUTH_ROUTES.has(path)) {
      // Drop the user back to login. The next page load will refetch /me.
      window.location.assign('/login');
    }
    throw new UnauthorizedError(401, parsed, parsed?.error.message ?? 'unauthorized');
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as TResponse;
  }

  if (!res.ok) {
    const parsed = await safeParseError(res);
    throw new ApiError(res.status, parsed, parsed?.error.message ?? `HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as TResponse;
  }
  return (await res.text()) as unknown as TResponse;
}

async function safeParseError(res: Response): Promise<ErrorResponse | undefined> {
  try {
    const data = await res.json();
    const parsed = errorResponseSchema.safeParse(data);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort user-facing message for an API call failure. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.body?.error.message) return err.body.error.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
