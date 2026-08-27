export type FieldErrors = Record<string, string[]>;

type ErrorPayload = {
  code?: unknown;
  message?: unknown;
  errors?: unknown;
  fieldErrors?: unknown;
};

const REQUEST_TIMEOUT_MS = 15_000;

function resolveApiBaseUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

  if (!configuredUrl) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NEXT_PUBLIC_API_URL is required in production');
    }

    return 'http://localhost:3001';
  }

  let url: URL;

  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error('NEXT_PUBLIC_API_URL must be a valid HTTP origin');
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('NEXT_PUBLIC_API_URL must be a valid HTTP origin');
  }

  return url.origin;
}

export const apiBaseUrl = resolveApiBaseUrl();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toMessages(value: unknown): string[] {
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }

  return [];
}

function extractFieldErrors(payload: ErrorPayload): FieldErrors {
  const fieldErrors: FieldErrors = {};
  const source = payload.fieldErrors ?? payload.errors;

  if (isRecord(source)) {
    for (const [field, value] of Object.entries(source)) {
      const messages = toMessages(value);

      if (messages.length > 0) {
        fieldErrors[field] = messages;
      }
    }
  }

  if (Array.isArray(source)) {
    for (const item of source) {
      if (!isRecord(item)) {
        continue;
      }

      const field =
        typeof item.field === 'string'
          ? item.field
          : typeof item.property === 'string'
            ? item.property
            : undefined;

      if (!field) {
        continue;
      }

      const constraintMessages = isRecord(item.constraints)
        ? Object.values(item.constraints).filter(
            (message): message is string => typeof message === 'string' && message.length > 0,
          )
        : [];
      const messages = [
        ...toMessages(item.messages),
        ...toMessages(item.message),
        ...constraintMessages,
      ];

      if (messages.length > 0) {
        fieldErrors[field] = messages;
      }
    }
  }

  return fieldErrors;
}

function extractMessage(payload: ErrorPayload): string {
  if (typeof payload.message === 'string' && payload.message.length > 0) {
    return payload.message;
  }

  if (Array.isArray(payload.message)) {
    const messages = toMessages(payload.message);

    if (messages.length > 0) {
      return messages.join(' ');
    }
  }

  return 'Запрос не выполнен';
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly fieldErrors: FieldErrors;

  constructor(status: number, payload: unknown) {
    const errorPayload = isRecord(payload) ? (payload as ErrorPayload) : {};

    super(extractMessage(errorPayload));
    this.name = 'ApiError';
    this.status = status;
    this.code = typeof errorPayload.code === 'string' ? errorPayload.code : undefined;
    this.fieldErrors = extractFieldErrors(errorPayload);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  return isApiError(error) && error.status < 500 && error.message !== 'Запрос не выполнен'
    ? error.message
    : fallback;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();

  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const headers = new Headers(init.headers);
  const requestController = new AbortController();
  const abortFromCaller = () => requestController.abort(init.signal?.reason);
  const timeout = setTimeout(
    () => requestController.abort(new DOMException('Request timed out', 'TimeoutError')),
    timeoutMs,
  );

  if (init.signal?.aborted) {
    abortFromCaller();
  } else {
    init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  headers.set('Accept', 'application/json');

  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1${path}`, {
      ...init,
      headers,
      signal: requestController.signal,
      credentials: 'include',
      cache: 'no-store',
    });
    const payload = await readResponseBody(response);

    if (!response.ok) {
      throw new ApiError(response.status, payload);
    }

    return payload as T;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
}
