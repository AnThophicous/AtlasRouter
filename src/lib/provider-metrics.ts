import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { recordAlert, resolveAlerts } from './alerts.js';
import type { ProviderId, ProviderStatusState } from '../types/router.js';

export interface ProviderRuntimeMetrics {
  providerId: ProviderId;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastObservedLatencyMs: number | null;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  rollingScore: number;
  lastStatus: ProviderStatusState | null;
  circuitOpenUntil: number | null;
}

const metrics = new Map<ProviderId, ProviderRuntimeMetrics>();
const stateDir = process.env.ATLAS_STATE_DIR ?? path.resolve(process.cwd(), '.atlasrouter');
const metricsPath = path.join(stateDir, 'provider-metrics.json');
const circuitFailureThreshold = Number(process.env.ATLAS_CIRCUIT_FAILURES ?? 3);
const circuitOpenMs = Number(process.env.ATLAS_CIRCUIT_OPEN_MS ?? 60000);

function baseMetrics(providerId: ProviderId): ProviderRuntimeMetrics {
  const baseScoreMap: Record<ProviderId, number> = {
    deeps: 880,
    qwen: 860,
    kimi: 840,
    mimo: 820,
    z2api: 800
  };

  return {
    providerId,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastObservedLatencyMs: null,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    rollingScore: baseScoreMap[providerId],
    lastStatus: null,
    circuitOpenUntil: null
  };
}

function isProviderId(value: string): value is ProviderId {
  return ['deeps', 'qwen', 'kimi', 'mimo', 'z2api'].includes(value);
}

function normalize(value: ProviderRuntimeMetrics): ProviderRuntimeMetrics {
  return {
    ...baseMetrics(value.providerId),
    ...value,
    circuitOpenUntil: value.circuitOpenUntil ?? null
  };
}

function loadPersistedMetrics(): void {
  if (!existsSync(metricsPath)) return;

  try {
    const payload = JSON.parse(readFileSync(metricsPath, 'utf8')) as Record<string, ProviderRuntimeMetrics>;
    for (const [providerId, value] of Object.entries(payload)) {
      if (isProviderId(providerId) && value.providerId === providerId) {
        metrics.set(providerId, normalize(value));
      }
    }
  } catch {
    return;
  }
}

function persistMetrics(): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(metricsPath, JSON.stringify(Object.fromEntries(metrics), null, 2));
  } catch {
    return;
  }
}

loadPersistedMetrics();

function getMetrics(providerId: ProviderId): ProviderRuntimeMetrics {
  const existing = metrics.get(providerId);
  if (existing) return existing;
  const created = baseMetrics(providerId);
  metrics.set(providerId, created);
  return created;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1000, Math.round(score)));
}

export function recordProviderSuccess(providerId: ProviderId, latencyMs: number | null): ProviderRuntimeMetrics {
  const current = getMetrics(providerId);
  const latencyPenalty = latencyMs === null ? 0 : Math.min(300, Math.round(latencyMs / 25));
  const next: ProviderRuntimeMetrics = {
    ...current,
    lastSuccessAt: Date.now(),
    lastObservedLatencyMs: latencyMs,
    successCount: current.successCount + 1,
    consecutiveFailures: 0,
    rollingScore: clampScore(current.rollingScore * 0.75 + (900 - latencyPenalty) * 0.25),
    lastStatus: 'online',
    circuitOpenUntil: null
  };
  metrics.set(providerId, next);
  resolveAlerts(providerId, ['provider_circuit_open', 'provider_degraded', 'provider_offline']);
  persistMetrics();
  return next;
}

export function recordProviderFailure(providerId: ProviderId, status: number | null, latencyMs: number | null): ProviderRuntimeMetrics {
  const current = getMetrics(providerId);
  const statusPenalty = status === null ? 120 : status >= 500 ? 180 : status >= 429 ? 100 : 60;
  const latencyPenalty = latencyMs === null ? 0 : Math.min(150, Math.round(latencyMs / 50));
  const next: ProviderRuntimeMetrics = {
    ...current,
    lastFailureAt: Date.now(),
    lastObservedLatencyMs: latencyMs ?? current.lastObservedLatencyMs,
    failureCount: current.failureCount + 1,
    consecutiveFailures: current.consecutiveFailures + 1,
    rollingScore: clampScore(current.rollingScore * 0.65 - (statusPenalty + latencyPenalty)),
    lastStatus: status === null ? 'offline' : status >= 500 ? 'degraded' : current.lastStatus,
    circuitOpenUntil: current.consecutiveFailures + 1 >= circuitFailureThreshold ? Date.now() + circuitOpenMs : current.circuitOpenUntil
  };
  metrics.set(providerId, next);
  if (next.lastStatus === 'offline') {
    recordAlert({
      severity: 'critical',
      providerId,
      code: 'provider_offline',
      message: `${providerId} stopped responding`
    });
  } else if (next.lastStatus === 'degraded') {
    recordAlert({
      severity: 'warning',
      providerId,
      code: 'provider_degraded',
      message: `${providerId} is returning unstable upstream responses`
    });
  }
  if (next.circuitOpenUntil && next.circuitOpenUntil > Date.now()) {
    recordAlert({
      severity: 'critical',
      providerId,
      code: 'provider_circuit_open',
      message: `${providerId} circuit is open after ${next.consecutiveFailures} consecutive failures`
    });
  }
  persistMetrics();
  return next;
}

export function getProviderMetrics(providerId: ProviderId): ProviderRuntimeMetrics {
  return { ...getMetrics(providerId) };
}

export function getProviderScore(providerId: ProviderId): number {
  const current = getMetrics(providerId);
  if (isProviderCircuitOpen(providerId)) return 0;
  const agePenalty = current.lastSuccessAt ? Math.min(60, Math.round((Date.now() - current.lastSuccessAt) / 60000)) : 0;
  const failurePenalty = current.consecutiveFailures * 120;
  const latencyPenalty = current.lastObservedLatencyMs === null ? 0 : Math.min(80, Math.round(current.lastObservedLatencyMs / 30));
  return clampScore(current.rollingScore - agePenalty - failurePenalty - latencyPenalty);
}

export function isProviderCircuitOpen(providerId: ProviderId): boolean {
  const current = getMetrics(providerId);
  return current.circuitOpenUntil !== null && current.circuitOpenUntil > Date.now();
}

export function resetProviderMetrics(providerId?: ProviderId): void {
  if (providerId) {
    metrics.delete(providerId);
    persistMetrics();
    return;
  }
  metrics.clear();
  persistMetrics();
}
