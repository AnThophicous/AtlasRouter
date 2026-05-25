import { Hono } from 'hono';
import { listAlerts } from '../lib/alerts.js';
import { listCompeatTraces } from '../lib/compeat-trace.js';
import { getRuntimeMetrics } from '../lib/runtime-metrics.js';
import { probeProvider } from '../services/provider-client.js';
import { listProxySupervisorStatus } from '../services/proxy-supervisor.js';
import type { AppEnv } from '../types/app.js';

export const providersRouter = new Hono<AppEnv>();

providersRouter.get('/v1/providers', async (c) => {
  const providers = c.get('providers');
  const statuses = await Promise.all(providers.map((provider) => probeProvider(provider)));

  return c.json({
    object: 'list',
    data: statuses
  });
});

providersRouter.get('/v1/router/alerts', (c) => {
  return c.json({
    object: 'list',
    data: listAlerts(c.req.query('include_resolved') === 'true')
  });
});

providersRouter.get('/v1/router/compeat', (c) => {
  return c.json({
    object: 'compeat.trace_list',
    ...listCompeatTraces()
  });
});

providersRouter.get('/v1/router/metrics', (c) => {
  return c.json({
    object: 'router.metrics',
    data: getRuntimeMetrics()
  });
});

providersRouter.get('/v1/router/supervisor', (c) => {
  return c.json({
    object: 'proxy_supervisor.status',
    data: listProxySupervisorStatus()
  });
});
