import type { OpenAIRequest } from '../types/openai.js';
import type { ProviderConfig, ProviderStatus } from '../types/router.js';
import { cleanProxyHeaders, fetchWithTimeout, joinUrl } from '../lib/http.js';
import { messageFromUnknown } from '../lib/errors.js';
import { withProviderSlot } from '../lib/provider-queue.js';
import { getProviderMetrics, getProviderScore, recordProviderFailure, recordProviderSuccess } from '../lib/provider-metrics.js';

export interface UpstreamChatResponse {
  response: Response;
  latencyMs: number;
  queueWaitMs: number;
}

function requestHeaders(provider: ProviderConfig, incomingHeaders?: Headers): Headers {
  const headers = new Headers();

  headers.set('content-type', 'application/json');
  headers.set('accept', incomingHeaders?.get('accept') ?? 'application/json');

  const auth = provider.apiKey
    ? `Bearer ${provider.apiKey}`
    : provider.forwardAuthorization
      ? incomingHeaders?.get('authorization')
      : null;
  if (auth) headers.set('authorization', auth);

  for (const key of [
    'x-request-id',
    'x-trace-id',
    'x-client-name',
    'x-client-version',
    'user-agent'
  ]) {
    const value = incomingHeaders?.get(key);
    if (value) headers.set(key, value);
  }

  return headers;
}

export async function fetchProviderModels(provider: ProviderConfig): Promise<{ data: unknown[]; latencyMs: number }> {
  const headers = requestHeaders(provider);
  const result = await fetchWithTimeout(joinUrl(provider.baseUrl, provider.modelsPath), { headers }, provider.timeoutMs);

  if (!result.response.ok) {
    throw new Error(`models returned HTTP ${result.response.status}`);
  }

  const payload = await result.response.json() as { data?: unknown[] };

  return {
    data: Array.isArray(payload.data) ? payload.data : [],
    latencyMs: result.latencyMs
  };
}

export async function probeProvider(provider: ProviderConfig): Promise<ProviderStatus> {
  const checkedAt = Math.floor(Date.now() / 1000);
  const runtime = getProviderMetrics(provider.id);

  try {
    const health = await fetchWithTimeout(joinUrl(provider.baseUrl, provider.healthPath), { headers: requestHeaders(provider) }, provider.healthTimeoutMs);
    if (!health.response.ok) {
      const updated = recordProviderFailure(provider.id, health.response.status, health.latencyMs);
      return {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        status: 'degraded',
        latencyMs: health.latencyMs,
        models: 0,
        error: `health returned HTTP ${health.response.status}`,
        checkedAt,
        score: getProviderScore(provider.id),
        successCount: updated.successCount,
        failureCount: updated.failureCount,
        consecutiveFailures: updated.consecutiveFailures,
        lastSuccessAt: updated.lastSuccessAt,
        lastFailureAt: updated.lastFailureAt,
        circuitOpenUntil: updated.circuitOpenUntil
      };
    }

    let models = 0;
    try {
      const modelResult = await fetchProviderModels(provider);
      models = modelResult.data.length;
    } catch {
      models = 0;
    }
    recordProviderSuccess(provider.id, health.latencyMs);
    const updated = getProviderMetrics(provider.id);

    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      status: 'online',
      latencyMs: health.latencyMs,
      models,
      error: null,
      checkedAt,
      score: getProviderScore(provider.id),
      successCount: updated.successCount,
      failureCount: updated.failureCount,
      consecutiveFailures: updated.consecutiveFailures,
      lastSuccessAt: updated.lastSuccessAt,
      lastFailureAt: updated.lastFailureAt,
      circuitOpenUntil: updated.circuitOpenUntil
    };
  } catch (error) {
    recordProviderFailure(provider.id, null, null);
    const updated = getProviderMetrics(provider.id);
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      status: 'offline',
      latencyMs: null,
      models: 0,
      error: messageFromUnknown(error),
      checkedAt,
      score: getProviderScore(provider.id),
      successCount: updated.successCount,
      failureCount: updated.failureCount,
      consecutiveFailures: updated.consecutiveFailures,
      lastSuccessAt: updated.lastSuccessAt,
      lastFailureAt: updated.lastFailureAt,
      circuitOpenUntil: updated.circuitOpenUntil
    };
  }
}

export async function forwardChatCompletion(
  provider: ProviderConfig,
  upstreamModel: string,
  body: OpenAIRequest,
  incomingHeaders: Headers,
  timeoutMs = provider.timeoutMs
): Promise<UpstreamChatResponse> {
  return withProviderSlot(provider.id, provider.maxConcurrent, provider.queueTimeoutMs, async (queueWaitMs) => {
    try {
      const url = joinUrl(provider.baseUrl, provider.chatPath);
      const headers = requestHeaders(provider, incomingHeaders);
      const payload: OpenAIRequest = {
        ...body,
        model: upstreamModel
      };

      const result = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      }, timeoutMs);

      if (result.response.ok) {
        recordProviderSuccess(provider.id, result.latencyMs);
      } else {
        recordProviderFailure(provider.id, result.response.status, result.latencyMs);
      }

      return {
        response: result.response,
        latencyMs: result.latencyMs,
        queueWaitMs
      };
    } catch (error) {
      recordProviderFailure(provider.id, null, null);
      throw error;
    }
  });
}

export function responseFromUpstream(response: Response, headers?: HeadersInit): Response {
  const nextHeaders = cleanProxyHeaders(response.headers);
  for (const [key, value] of new Headers(headers)) {
    nextHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders
  });
}
