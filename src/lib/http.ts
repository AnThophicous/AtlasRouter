export interface TimedFetchResult {
  response: Response;
  latencyMs: number;
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<TimedFetchResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    return {
      response,
      latencyMs: Math.round(performance.now() - startedAt)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cleanProxyHeaders(headers: Headers): Headers {
  const next = new Headers(headers);
  next.delete('content-length');
  next.delete('content-encoding');
  next.delete('transfer-encoding');
  next.delete('connection');
  return next;
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}
