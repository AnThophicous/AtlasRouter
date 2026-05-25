import { Hono } from 'hono';
import type { AppEnv } from '../types/app.js';
import { probeProvider } from '../services/provider-client.js';

export const healthRouter = new Hono<AppEnv>();
const startedAt = Date.now();

healthRouter.get('/health', (c) => c.json({
  status: 'ok',
  uptime: Math.round((Date.now() - startedAt) / 1000)
}));

healthRouter.get('/v1/router/health', async (c) => {
  const providers = c.get('providers');
  const statuses = await Promise.all(providers.map((provider) => probeProvider(provider)));
  const online = statuses.filter((item) => item.status === 'online').length;

  return c.json({
    status: online > 0 ? 'ok' : 'degraded',
    uptime: Math.round((Date.now() - startedAt) / 1000),
    providers: statuses
  });
});
