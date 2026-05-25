import { Hono } from 'hono';
import { ZodError } from 'zod';
import { getRouterRequestTimeoutMs } from '../config/providers.js';
import { anthropicRequestToChatRequest, anthropicStream, chatPayloadToAnthropicMessage } from '../lib/anthropic.js';
import { openAIError } from '../lib/errors.js';
import { recordRouterRequest } from '../lib/runtime-metrics.js';
import { resolveRoute } from '../services/model-registry.js';
import { routeChatCompletion } from '../services/router-service.js';
import type { AppEnv } from '../types/app.js';
import { formatZodError, parseAnthropicMessagesRequest } from '../validation/openai.js';

export const messagesRouter = new Hono<AppEnv>();

messagesRouter.post('/v1/messages', async (c) => {
  const startedAt = performance.now();
  let body;

  try {
    body = parseAnthropicMessagesRequest(await c.req.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return openAIError(formatZodError(error), 400, 'invalid_request_error', 'invalid_request');
    }
    return openAIError('Invalid JSON body', 400, 'invalid_request_error', 'invalid_json');
  }

  const chatBody = anthropicRequestToChatRequest(body);
  const resolution = await resolveRoute(chatBody.model);
  if (!resolution) {
    return openAIError(`Unknown model: ${chatBody.model}`, 404, 'invalid_request_error', 'model_not_found', 'model');
  }

  const result = await routeChatCompletion(resolution, {
    body: { ...chatBody, stream: false },
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

  if (!result.response.ok) return result.response;

  const payload = await result.response.clone().json() as any;
  const message = chatPayloadToAnthropicMessage(payload, body.model);

  return body.stream ? anthropicStream(message) : c.json(message);
});
