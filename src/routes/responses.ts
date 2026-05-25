import { Hono } from 'hono';
import { ZodError } from 'zod';
import { getRouterRequestTimeoutMs } from '../config/providers.js';
import { openAIError } from '../lib/errors.js';
import { adaptChatPayloadToResponse, deleteStoredResponse, getStoredResponse, responseRequestToChatRequest, responsesStream, storeResponse, storedResponseInputItems } from '../lib/responses.js';
import { recordRouterRequest } from '../lib/runtime-metrics.js';
import { resolveRoute } from '../services/model-registry.js';
import { routeChatCompletion } from '../services/router-service.js';
import type { AppEnv } from '../types/app.js';
import { formatZodError, parseResponsesRequest } from '../validation/openai.js';

export const responsesRouter = new Hono<AppEnv>();

responsesRouter.post('/v1/responses', async (c) => {
  const startedAt = performance.now();
  let body;

  try {
    body = parseResponsesRequest(await c.req.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return openAIError(formatZodError(error), 400, 'invalid_request_error', 'invalid_request');
    }
    return openAIError('Invalid JSON body', 400, 'invalid_request_error', 'invalid_json');
  }

  if (body.previous_response_id && !getStoredResponse(body.previous_response_id)) {
    return openAIError(`Unknown response: ${body.previous_response_id}`, 404, 'invalid_request_error', 'response_not_found', 'previous_response_id');
  }

  const adapted = responseRequestToChatRequest(body);
  if (adapted.unsupported) {
    return openAIError(adapted.unsupported, 400, 'invalid_request_error', 'unsupported_tool', 'tools');
  }

  const resolution = await resolveRoute(adapted.request.model);
  if (!resolution) {
    return openAIError(`Unknown model: ${adapted.request.model}`, 404, 'invalid_request_error', 'model_not_found', 'model');
  }

  const result = await routeChatCompletion(resolution, {
    body: { ...adapted.request, stream: false },
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
  const responseBody = adaptChatPayloadToResponse(payload, body.model);
  const assistantText = typeof responseBody.output_text === 'string' ? responseBody.output_text : '';

  storeResponse(responseBody, [
    ...adapted.messages,
    { role: 'assistant', content: assistantText }
  ], adapted.inputItems);

  if (body.stream) {
    return responsesStream(responseBody);
  }

  return c.json(responseBody);
});

responsesRouter.get('/v1/responses/:responseId', (c) => {
  const stored = getStoredResponse(c.req.param('responseId'));
  if (!stored) {
    return openAIError(`Unknown response: ${c.req.param('responseId')}`, 404, 'invalid_request_error', 'response_not_found', 'response_id');
  }

  return c.json(stored.body);
});

responsesRouter.get('/v1/responses/:responseId/input_items', (c) => {
  const items = storedResponseInputItems(c.req.param('responseId'));
  if (!items) {
    return openAIError(`Unknown response: ${c.req.param('responseId')}`, 404, 'invalid_request_error', 'response_not_found', 'response_id');
  }

  return c.json({
    object: 'list',
    data: items,
    first_id: typeof items[0]?.id === 'string' ? items[0].id : null,
    last_id: typeof items.at(-1)?.id === 'string' ? items.at(-1)?.id : null,
    has_more: false
  });
});

responsesRouter.delete('/v1/responses/:responseId', (c) => {
  const responseId = c.req.param('responseId');
  const deleted = deleteStoredResponse(responseId);
  if (!deleted) {
    return openAIError(`Unknown response: ${responseId}`, 404, 'invalid_request_error', 'response_not_found', 'response_id');
  }

  return c.json({
    id: responseId,
    object: 'response.deleted',
    deleted: true
  });
});
