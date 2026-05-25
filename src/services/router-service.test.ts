import assert from 'node:assert/strict';
import test from 'node:test';
import { resetProviderMetrics } from '../lib/provider-metrics.js';
import type { OpenAIRequest } from '../types/openai.js';
import type { CapabilitySet, ProviderConfig, ProviderId, RouteCandidate, RouteResolution, RoutedModel } from '../types/router.js';
import { routeChatCompletion } from './router-service.js';

function capabilities(): CapabilitySet {
  return {
    chat: true,
    streaming: true,
    tools: true,
    reasoning: false,
    vision: false,
    files: false
  };
}

function provider(id: ProviderId, port: number): ProviderConfig {
  return {
    id,
    name: id,
    baseUrl: `http://127.0.0.1:${port}`,
    enabled: true,
    priority: port,
    maxConcurrent: 1,
    queueTimeoutMs: 1000,
    timeoutMs: 1000,
    healthTimeoutMs: 1000,
    modelCacheTtlMs: 1000,
    maxRetries: 0,
    retryDelayMs: 1,
    forwardAuthorization: false,
    healthPath: '/health',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions',
    capabilities: capabilities()
  };
}

function candidate(providerConfig: ProviderConfig, modelId: string): RouteCandidate {
  const model: RoutedModel = {
    id: modelId,
    object: 'model',
    created: 0,
    owned_by: providerConfig.id,
    providerId: providerConfig.id,
    upstreamModel: modelId,
    aliases: [],
    source: 'static',
    priority: 1,
    capabilities: {
      ...capabilities(),
      nativeProvider: providerConfig.id
    }
  };

  return {
    provider: providerConfig,
    model
  };
}

test('router service falls back to next provider after retryable upstream failure', async () => {
  resetProviderMetrics();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('9101')) {
      return Response.json({ error: { message: 'broken' } }, { status: 500 });
    }
    return Response.json({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 0,
      model: 'qwen-test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
    });
  };

  try {
    const body: OpenAIRequest = {
      model: 'atlas/auto',
      messages: [{ role: 'user', content: 'ping' }]
    };
    const resolution: RouteResolution = {
      requestedModel: 'atlas/auto',
      candidates: [
        candidate(provider('deeps', 9101), 'deepseek-test'),
        candidate(provider('qwen', 9102), 'qwen-test')
      ]
    };

    const result = await routeChatCompletion(resolution, {
      body,
      headers: new Headers(),
      requestId: 'test-request',
      deadlineAt: Date.now() + 5000
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0]?.providerId, 'deeps');
    assert.equal(result.attempts[1]?.providerId, 'qwen');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    resetProviderMetrics();
  }
});
