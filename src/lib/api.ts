import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 20_000,
      refetchOnWindowFocus: false,
    },
  },
});

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly missingFields?: string[];

  constructor(
    message: string,
    status: number,
    code = 'API_ERROR',
    details?: unknown,
    missingFields?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.missingFields = missingFields;
  }
}

function getCookieValue(name: string): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (!isFormData && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const method = (options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = getCookieValue('levelup_csrf');
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.ok) {
    const err = payload?.error;
    let message = err?.message || `Request failed (${res.status})`;
    if (err?.code === 'VALIDATION_ERROR' && err?.details && typeof err.details === 'object') {
      const firstFieldError = Object.values(err.details as Record<string, unknown>)
        .flat()
        .find((v): v is string => typeof v === 'string' && v.trim().length > 0);
      if (firstFieldError) {
        message = firstFieldError;
      }
    }
    throw new ApiError(
      message,
      res.status,
      err?.code || 'API_ERROR',
      err?.details,
      err?.missingFields,
    );
  }

  return payload.data as T;
}
