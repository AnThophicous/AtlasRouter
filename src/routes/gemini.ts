import { Hono } from 'hono';
import { ZodError } from 'zod';
import { getRouterRequestTimeoutMs } from '../config/providers.js';
import { openAIError } from '../lib/errors.js';
import { chatPayloadToGeminiResponse, geminiRequestToChatRequest, geminiStream, normalizeGeminiModel, publicModelToGeminiModel } from '../lib/gemini.js';
import { recordRouterRequest } from '../lib/runtime-metrics.js';
import { listPublicModels, resolveRoute } from '../services/model-registry.js';
import { routeChatCompletion } from '../services/router-service.js';
import type { AppEnv } from '../types/app.js';
import { formatZodError, parseGeminiGenerateContentRequest } from '../validation/openai.js';

export const geminiRouter = new Hono<AppEnv>();

geminiRouter.get('/gemini/v1beta/models', async (c) => {
  const models = await listPublicModels();
  return c.json({
    models: models.map(publicModelToGeminiModel)
  });
});

geminiRouter.get('/gemini/v1beta/models/*', async (c) => {
  const pathname = new URL(c.req.url).pathname;
  const raw = pathname.slice('/gemini/v1beta/models/'.length);
  const modelName = raw.split(':')[0] ?? raw;
  const model = normalizeGeminiModel(modelName);
  const models = await listPublicModels();
  const found = models.find((item) => item.id === model || item.id.replace(/\//g, '-') === modelName);

  if (!found) {
    return c.json({ error: { message: `Model not found: ${model}` } }, 404);
  }

  return c.json(publicModelToGeminiModel(found));
});

geminiRouter.post('/gemini/v1beta/models/*', async (c) => {
  const startedAt = performance.now();
  const pathname = new URL(c.req.url).pathname;
  const raw = pathname.slice('/gemini/v1beta/models/'.length);
  const action = raw.endsWith(':streamGenerateContent') ? 'streamGenerateContent' : raw.endsWith(':generateContent') ? 'generateContent' : null;
  const modelName = raw.replace(/:(streamGenerateContent|generateContent)$/, '');

  if (!action) {
    return c.json({ error: { message: 'Unsupported Gemini model action' } }, 404);
  }

  let body;
  try {
    body = parseGeminiGenerateContentRequest(await c.req.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return openAIError(formatZodError(error), 400, 'invalid_request_error', 'invalid_request');
    }
    return openAIError('Invalid JSON body', 400, 'invalid_request_error', 'invalid_json');
  }

  const model = normalizeGeminiModel(modelName);
  const chatBody = geminiRequestToChatRequest(body, model);
  const resolution = await resolveRoute(chatBody.model);
  if (!resolution) {
    return c.json({ error: { message: `Model not found: ${chatBody.model}` } }, 404);
  }

  const result = await routeChatCompletion(resolution, {
    body: { ...chatBody, stream: false },
    headers: c.req.raw.headers,
    requestId: c.get('requestId'),
    deadlineAt: Date.now() + getRouterRequestTimeoutMs()
  });

  recordRouterRequest({
    model: chatBody.model,
    status: result.response.status,
    latencyMs: Math.round(performance.now() - startedAt),
    attempts: result.attempts
  });

  if (!result.response.ok) return result.response;

  const payload = await result.response.clone().json() as any;
  const geminiResponse = chatPayloadToGeminiResponse(payload, chatBody.model);

  return action === 'streamGenerateContent' || new URL(c.req.url).searchParams.get('alt') === 'sse'
    ? geminiStream(geminiResponse, chatBody.model)
    : c.json(geminiResponse);
});
