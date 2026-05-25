import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getSupervisorHealthIntervalMs, getSupervisorRestartBaseDelayMs } from '../config/providers.js';
import { fetchWithTimeout, joinUrl } from '../lib/http.js';
import type { ProviderConfig, ProviderId } from '../types/router.js';

export type SupervisorState = 'disabled' | 'starting' | 'online' | 'offline' | 'restarting' | 'external';

export interface ProxyProcessStatus {
  providerId: ProviderId;
  state: SupervisorState;
  pid: number | null;
  cwd: string;
  port: number | null;
  starts: number;
  restarts: number;
  lastExitCode: number | null;
  lastSignal: string | null;
  lastHealthAt: number | null;
  lastError: string | null;
}

interface SupervisedProxy {
  provider: ProviderConfig;
  cwd: string;
  port: number | null;
  process: ChildProcess | null;
  status: ProxyProcessStatus;
  restartTimer: NodeJS.Timeout | null;
}

const proxies = new Map<ProviderId, SupervisedProxy>();
let healthTimer: NodeJS.Timeout | null = null;

function log(event: string, value: Record<string, unknown>): void {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    event,
    ...value
  }));
}

function providerSourceDir(providerId: ProviderId): string | null {
  const map: Partial<Record<ProviderId, string>> = {
    deeps: 'deepsproxy',
    qwen: 'qwenproxy',
    kimi: 'kimiproxy'
  };
  const dir = map[providerId];
  return dir ? path.resolve(process.cwd(), 'sources', dir) : null;
}

function baseUrlPort(baseUrl: string): number | null {
  try {
    const parsed = new URL(baseUrl);
    return parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return null;
  }
}

async function isHealthy(proxy: SupervisedProxy): Promise<boolean> {
  try {
    const result = await fetchWithTimeout(joinUrl(proxy.provider.baseUrl, proxy.provider.healthPath), {}, proxy.provider.healthTimeoutMs);
    return result.response.ok;
  } catch {
    return false;
  }
}

function createProxy(provider: ProviderConfig, cwd: string): SupervisedProxy {
  return {
    provider,
    cwd,
    port: baseUrlPort(provider.baseUrl),
    process: null,
    restartTimer: null,
    status: {
      providerId: provider.id,
      state: 'offline',
      pid: null,
      cwd,
      port: baseUrlPort(provider.baseUrl),
      starts: 0,
      restarts: 0,
      lastExitCode: null,
      lastSignal: null,
      lastHealthAt: null,
      lastError: null
    }
  };
}

function scheduleRestart(proxy: SupervisedProxy): void {
  if (proxy.restartTimer) return;
  proxy.status.state = 'restarting';
  const delay = Math.min(30_000, getSupervisorRestartBaseDelayMs() * Math.max(1, proxy.status.restarts + 1));
  proxy.restartTimer = setTimeout(() => {
    proxy.restartTimer = null;
    proxy.status.restarts++;
    startProxyProcess(proxy);
  }, delay);
}

function startProxyProcess(proxy: SupervisedProxy): void {
  if (proxy.process) return;
  proxy.status.state = 'starting';
  proxy.status.starts++;
  const env = {
    ...process.env,
    PORT: proxy.port ? String(proxy.port) : process.env.PORT
  };
  const child = spawn('npm', ['start'], {
    cwd: proxy.cwd,
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  proxy.process = child;
  proxy.status.pid = child.pid ?? null;
  proxy.status.lastError = null;
  log('proxy_started', { providerId: proxy.provider.id, pid: proxy.status.pid, cwd: proxy.cwd, port: proxy.port });

  child.stdout.on('data', (data) => {
    process.stdout.write(`[${proxy.provider.id}] ${String(data)}`);
  });
  child.stderr.on('data', (data) => {
    process.stderr.write(`[${proxy.provider.id}] ${String(data)}`);
  });
  child.on('exit', (code, signal) => {
    proxy.process = null;
    proxy.status.pid = null;
    proxy.status.lastExitCode = code;
    proxy.status.lastSignal = signal;
    proxy.status.state = 'offline';
    log('proxy_exited', { providerId: proxy.provider.id, code, signal });
    scheduleRestart(proxy);
  });
  child.on('error', (error) => {
    proxy.status.lastError = error.message;
    proxy.status.state = 'offline';
    log('proxy_error', { providerId: proxy.provider.id, error: error.message });
    scheduleRestart(proxy);
  });
}

async function ensureProxy(proxy: SupervisedProxy): Promise<void> {
  const healthy = await isHealthy(proxy);
  if (healthy) {
    proxy.status.lastHealthAt = Date.now();
    proxy.status.state = proxy.process ? 'online' : 'external';
    proxy.status.lastError = null;
    return;
  }

  proxy.status.lastError = 'health check failed';
  if (!proxy.process) {
    startProxyProcess(proxy);
  }
}

async function checkAll(): Promise<void> {
  await Promise.all([...proxies.values()].map((proxy) => ensureProxy(proxy)));
}

export async function startProxySupervisor(providers: ProviderConfig[]): Promise<void> {
  for (const provider of providers) {
    const cwd = providerSourceDir(provider.id);
    if (!cwd || !existsSync(path.join(cwd, 'package.json'))) continue;
    proxies.set(provider.id, createProxy(provider, cwd));
  }

  await checkAll();
  healthTimer = setInterval(() => {
    void checkAll();
  }, getSupervisorHealthIntervalMs());
}

export function listProxySupervisorStatus(): ProxyProcessStatus[] {
  return [...proxies.values()].map((proxy) => ({ ...proxy.status }));
}

export function stopProxySupervisor(): void {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
  for (const proxy of proxies.values()) {
    if (proxy.restartTimer) clearTimeout(proxy.restartTimer);
    proxy.restartTimer = null;
    if (proxy.process) proxy.process.kill('SIGTERM');
  }
}
