import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CapabilitySet, ProviderConfig, ProviderId } from '../types/router.js';

type ProviderDefaults = Omit<Partial<ProviderConfig>, 'capabilities'> & {
  capabilities?: Partial<CapabilitySet>;
};

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : undefined;
}

function readBool(key: string, fallback = true): boolean {
  const value = readEnv(key);
  if (value === undefined) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function readNumber(key: string, fallback: number): number {
  const value = readEnv(key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sourceDir(providerId: ProviderId): string | null {
  const map: Partial<Record<ProviderId, string>> = {
    deeps: 'deepsproxy',
    qwen: 'qwenproxy',
    kimi: 'kimiproxy',
    mimo: 'mimo-ai-proxy',
    z2api: 'z2api-nest'
  };
  const dir = map[providerId];
  return dir ? path.resolve(process.cwd(), 'sources', dir) : null;
}

function hasLocalSource(providerId: ProviderId): boolean {
  const dir = sourceDir(providerId);
  return dir !== null && existsSync(path.join(dir, 'package.json'));
}

function isConfiguredProvider(provider: ProviderConfig): boolean {
  const prefix = provider.id.toUpperCase();
  if (readEnv(`${prefix}_BASE_URL`)) return true;
  if (provider.id === 'mimo' || provider.id === 'z2api') return provider.enabled && hasLocalSource(provider.id);
  return provider.enabled && hasLocalSource(provider.id);
}

function capabilities(value: Partial<CapabilitySet>): CapabilitySet {
  return {
    chat: value.chat ?? true,
    streaming: value.streaming ?? true,
    tools: value.tools ?? false,
    reasoning: value.reasoning ?? false,
    vision: value.vision ?? false,
    files: value.files ?? false
  };
}

function provider(
  id: ProviderId,
  name: string,
  port: number,
  priority: number,
  value: ProviderDefaults
): ProviderConfig {
  const prefix = id.toUpperCase();
  return {
    id,
    name,
    baseUrl: readEnv(`${prefix}_BASE_URL`) ?? `http://127.0.0.1:${port}`,
    apiKey: readEnv(`${prefix}_API_KEY`),
    enabled: readBool(`${prefix}_ENABLED`, value.enabled ?? true),
    priority: readNumber(`${prefix}_PRIORITY`, value.priority ?? priority),
    maxConcurrent: readNumber(`${prefix}_MAX_CONCURRENT`, value.maxConcurrent ?? (id === 'deeps' ? 2 : 1)),
    queueTimeoutMs: readNumber(`${prefix}_QUEUE_TIMEOUT_MS`, value.queueTimeoutMs ?? 45_000),
    timeoutMs: readNumber(`${prefix}_TIMEOUT_MS`, value.timeoutMs ?? 30_000),
    healthTimeoutMs: readNumber(`${prefix}_HEALTH_TIMEOUT_MS`, value.healthTimeoutMs ?? 2_000),
    modelCacheTtlMs: readNumber(`${prefix}_MODEL_CACHE_TTL_MS`, value.modelCacheTtlMs ?? 60_000),
    maxRetries: readNumber(`${prefix}_MAX_RETRIES`, value.maxRetries ?? 0),
    retryDelayMs: readNumber(`${prefix}_RETRY_DELAY_MS`, value.retryDelayMs ?? 250),
    forwardAuthorization: readBool(`${prefix}_FORWARD_AUTHORIZATION`, value.forwardAuthorization ?? false),
    healthPath: readEnv(`${prefix}_HEALTH_PATH`) ?? value.healthPath ?? '/health',
    modelsPath: readEnv(`${prefix}_MODELS_PATH`) ?? value.modelsPath ?? '/v1/models',
    chatPath: readEnv(`${prefix}_CHAT_PATH`) ?? value.chatPath ?? '/v1/chat/completions',
    capabilities: capabilities(value.capabilities ?? {})
  };
}

export function getProviderConfigs(): ProviderConfig[] {
  const providers: ProviderConfig[] = [
    provider('deeps', 'DeepSeek', 3101, 10, {
      maxConcurrent: 2,
      capabilities: { tools: true, reasoning: true }
    }),
    provider('qwen', 'Qwen', 3102, 20, {
      maxConcurrent: 1,
      capabilities: { tools: true, reasoning: true }
    }),
    provider('kimi', 'Kimi', 3103, 30, {
      maxConcurrent: 1,
      capabilities: { tools: true, reasoning: true }
    }),
    provider('mimo', 'Mimo AI', 3104, 40, {
      enabled: false,
      timeoutMs: 60_000,
      maxConcurrent: 1,
      capabilities: { tools: true, reasoning: true, vision: true, files: true }
    }),
    provider('z2api', 'Z.ai', 3105, 50, {
      enabled: false,
      healthPath: '/v1/health',
      maxConcurrent: 1,
      capabilities: { reasoning: true, vision: true }
    })
  ];

  return providers
    .filter((item) => item.enabled && item.baseUrl.length > 0 && isConfiguredProvider(item))
    .sort((a, b) => a.priority - b.priority);
}

export function getRouterPort(): number {
  return readNumber('PORT', 3000);
}

export function getRouterRequestTimeoutMs(): number {
  return readNumber('ATLAS_REQUEST_TIMEOUT_MS', 60_000);
}

export function getSupervisorEnabled(): boolean {
  return readBool('ATLAS_SUPERVISOR_ENABLED', true);
}

export function getSupervisorHealthIntervalMs(): number {
  return readNumber('ATLAS_SUPERVISOR_HEALTH_INTERVAL_MS', 15_000);
}

export function getSupervisorRestartBaseDelayMs(): number {
  return readNumber('ATLAS_SUPERVISOR_RESTART_BASE_DELAY_MS', 2_000);
}
