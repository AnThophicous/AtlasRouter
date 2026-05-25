import type { ProviderId, UpstreamAttempt } from '../types/router.js';

export interface RuntimeProviderMetrics {
  attempts: number;
  failures: number;
  totalLatencyMs: number;
}

export interface RuntimeMetricsSnapshot {
  startedAt: number;
  uptimeSeconds: number;
  requests: number;
  failures: number;
  totalLatencyMs: number;
  byModel: Record<string, number>;
  byStatus: Record<string, number>;
  providers: Record<string, RuntimeProviderMetrics>;
}

const startedAt = Date.now();
const byModel = new Map<string, number>();
const byStatus = new Map<string, number>();
const providers = new Map<ProviderId, RuntimeProviderMetrics>();
let requests = 0;
let failures = 0;
let totalLatencyMs = 0;

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function providerMetrics(providerId: ProviderId): RuntimeProviderMetrics {
  const existing = providers.get(providerId);
  if (existing) return existing;
  const created = { attempts: 0, failures: 0, totalLatencyMs: 0 };
  providers.set(providerId, created);
  return created;
}

export function recordRouterRequest(value: {
  model: string;
  status: number;
  latencyMs: number;
  attempts: UpstreamAttempt[];
}): void {
  requests++;
  totalLatencyMs += value.latencyMs;
  if (value.status >= 400) failures++;
  increment(byModel, value.model);
  increment(byStatus, String(value.status));

  for (const attempt of value.attempts) {
    const current = providerMetrics(attempt.providerId);
    current.attempts++;
    if (attempt.status === null || attempt.status >= 400) current.failures++;
    if (attempt.latencyMs !== null) current.totalLatencyMs += attempt.latencyMs;
  }
}

export function getRuntimeMetrics(): RuntimeMetricsSnapshot {
  return {
    startedAt,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    requests,
    failures,
    totalLatencyMs,
    byModel: Object.fromEntries(byModel),
    byStatus: Object.fromEntries(byStatus),
    providers: Object.fromEntries(providers)
  };
}
