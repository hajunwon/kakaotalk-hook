/**
 * HTTP client wrapper for REST API calls (authentication, etc.)
 * Refactored from auth.ts request() function.
 */

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
}

/**
 * Make an HTTP request with automatic content-type handling.
 *
 * - Object body → JSON (application/json)
 * - URLSearchParams body → form-urlencoded
 * - No body → no content-type
 */
export async function httpRequest<T = unknown>(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<HttpResponse<T>> {
  const isJson = typeof body === 'object' && !(body instanceof URLSearchParams);

  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...(body instanceof URLSearchParams
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : {}),
    },
    body: body
      ? isJson
        ? JSON.stringify(body)
        : body.toString()
      : undefined,
  });

  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data };
}
