import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import { openAIError, messageFromUnknown } from './lib/errors.js';
import { healthRouter } from './routes/health.js';
import { modelsRouter } from './routes/models.js';
import { chatRouter } from './routes/chat.js';
import { providersRouter } from './routes/providers.js';
import { getProviderConfigs, getRouterPort, getSupervisorEnabled } from './config/providers.js';
import { startProxySupervisor, stopProxySupervisor } from './services/proxy-supervisor.js';
import type { AppEnv } from './types/app.js';

const app = new Hono<AppEnv>();
const providers = getProviderConfigs();

if (getSupervisorEnabled()) {
  void startProxySupervisor(providers);
}

process.once('SIGINT', () => {
  stopProxySupervisor();
  process.exit(0);
});

process.once('SIGTERM', () => {
  stopProxySupervisor();
  process.exit(0);
});

app.use('*', cors());

app.use('*', async (c, next) => {
  const startedAt = performance.now();
  const requestId = c.req.header('x-request-id') ?? randomUUID();
  c.set('requestId', requestId);
  c.set('providers', providers);
  c.header('x-atlas-request-id', requestId);
  try {
    await next();
  } finally {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      event: 'http_request',
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      latencyMs: Math.round(performance.now() - startedAt)
    }));
  }
});

app.route('/', healthRouter);
app.route('/', modelsRouter);
app.route('/', providersRouter);
app.route('/', chatRouter);

app.notFound((c) => c.json({
  error: {
    message: 'Route not found',
    type: 'invalid_request_error',
    param: null,
    code: 'not_found'
  }
}, 404));

app.onError((error) => {
  if (error instanceof ZodError) {
    return openAIError(error.message, 400, 'invalid_request_error', 'invalid_request');
  }
  return openAIError(messageFromUnknown(error), 500, 'api_error', 'internal_error');
});

const port = getRouterPort();

serve({
  fetch: app.fetch,
  port
});

console.log(`AtlasRouter listening on http://127.0.0.1:${port}`);
