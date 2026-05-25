import { Hono } from 'hono';
import { ZodError } from 'zod';
import { getRouterRequestTimeoutMs } from '../config/providers.js';
import { openAIError } from '../lib/errors.js';
import { recordRouterRequest } from '../lib/runtime-metrics.js';
import { resolveRoute } from '../services/model-registry.js';
import { routeChatCompletion } from '../services/router-service.js';
import type { AppEnv } from '../types/app.js';
import { formatZodError, parseChatCompletionRequest } from '../validation/openai.js';

export const chatRouter = new Hono<AppEnv>();

chatRouter.post('/v1/chat/completions', async (c) => {
  const startedAt = performance.now();
  let body;

  try {
    body = parseChatCompletionRequest(await c.req.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return openAIError(formatZodError(error), 400, 'invalid_request_error', 'invalid_request');
    }
    return openAIError('Invalid JSON body', 400, 'invalid_request_error', 'invalid_json');
  }

  const resolution = await resolveRoute(body.model);
  if (!resolution) {
    return openAIError(`Unknown model: ${body.model}`, 404, 'invalid_request_error', 'model_not_found', 'model');
  }

  const result = await routeChatCompletion(resolution, {
    body,
    headers: c.req.raw.headers,
    requestId: c.get('requestId'),
    deadlineAt: Date.now() + getRouterRequestTimeoutMs()
  });

  recordRouterRequest({
    model: body.model,
    status: result.response.status,
    latencyMs: Math.round(performance.now() - startedAt),
    attempts: result.attempts
  });

  return result.response;
});
