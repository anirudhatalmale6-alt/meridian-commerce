/**
 * The single place this app talks to the server.
 *
 * Two things every call gets for free:
 *  - `credentials: 'include'`, because auth lives in httpOnly cookies. Forget
 *    it on one call and that endpoint is silently anonymous.
 *  - a transparent refresh-and-retry on 401, so a 15-minute access token
 *    expiring mid-session is invisible to the user instead of bouncing them to
 *    the login page while they are filling in a checkout form.
 */

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: { path: string; message: string }[] | Record<string, unknown>;
}

export class ApiError extends Error {
  // Written out longhand rather than as constructor parameter properties:
  // Vite's tsconfig enables `erasableSyntaxOnly`, which bans any TS syntax
  // that emits runtime code. Parameter properties do, so they are not allowed.
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorShape['details'];

  constructor(status: number, code: string, message: string, details?: ApiErrorShape['details']) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level messages, when the server sent a validation failure. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details) {
      if (d && typeof d.path === 'string' && !out[d.path]) out[d.path] = d.message;
    }
    return out;
  }
}

const BASE = '/api';

// A single in-flight refresh shared by every caller. Without this, a page that
// fires five queries at once on a stale token sends five refreshes; the first
// rotates the token and the other four present a revoked one and fail, logging
// the user out at random.
let refreshInFlight: Promise<boolean> | null = null;

/** Readable flag the server sets alongside the httpOnly auth cookies. */
function hasSessionHint(): boolean {
  return document.cookie.split('; ').some((c) => c.startsWith('shop_session='));
}

async function refreshSession(): Promise<boolean> {
  // No session to refresh: do not spend a round trip proving it. This is what
  // keeps an anonymous visitor's console clean instead of showing a 401 that
  // was always going to happen.
  if (!hasSessionHint()) return false;

  if (!refreshInFlight) {
    refreshInFlight = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Set for the auth endpoints themselves, so a failed login cannot recurse. */
  skipRefresh?: boolean;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipRefresh = false, signal } = options;

  const send = () =>
    fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });

  let response = await send();

  if (response.status === 401 && !skipRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) response = await send();
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // A non-JSON body on an error is almost always a proxy or gateway page.
      // Surface that honestly rather than crashing on JSON.parse.
      if (!response.ok) {
        throw new ApiError(response.status, 'BAD_RESPONSE', `Server returned ${response.status}.`);
      }
    }
  }

  if (!response.ok) {
    const err = (payload as { error?: ApiErrorShape } | null)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Request failed with ${response.status}.`,
      err?.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown, skipRefresh = false) =>
    request<T>(path, { method: 'POST', body, skipRefresh }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};
