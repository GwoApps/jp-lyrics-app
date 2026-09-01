export type ApiFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor(status: number, code?: string, body?: unknown) {
    super(code ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiError(response.status, 'invalid_response');
  }
  try {
    return await response.json();
  } catch {
    throw new ApiError(response.status, 'invalid_response');
  }
}

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  fetcher: ApiFetcher = fetch,
): Promise<T> {
  const response = await fetcher(input, init);
  const body = await readBody(response);
  if (!response.ok) {
    const code = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : undefined;
    throw new ApiError(response.status, code, body);
  }
  return body as T;
}

export async function jsonRequest<T>(
  input: RequestInfo | URL,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
  fetcher: ApiFetcher = fetch,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  return apiRequest<T>(input, {
    ...init,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, fetcher);
}
