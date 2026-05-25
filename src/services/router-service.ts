import type { ChatRequestContext, ChatRouteResult, RouteCandidate, RouteResolution, UpstreamAttempt } from '../types/router.js';
import { randomUUID } from 'node:crypto';
import { scoreCompeatCandidate, type CompeatScoreBreakdown } from '../lib/compeat-score.js';
import { finishCompeatTrace, startCompeatTrace, updateCompeatCandidate } from '../lib/compeat-trace.js';
import { openAIError, messageFromUnknown } from '../lib/errors.js';
import { isRetryableStatus, sleep } from '../lib/http.js';
import { getProviderScore, isProviderCircuitOpen } from '../lib/provider-metrics.js';
import { forwardChatCompletion, responseFromUpstream } from './provider-client.js';

interface CompeatResult {
  attempt: UpstreamAttempt;
  response: Response | null;
  payload: any;
  content: string;
  score: number;
  breakdown: CompeatScoreBreakdown | null;
}

async function readError(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = await response.clone().json() as any;
      return payload?.error?.message ?? payload?.message ?? JSON.stringify(payload);
    }
    return await response.clone().text();
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

function attemptHeaders(requestId: string, attempt: UpstreamAttempt): HeadersInit {
  return {
    'x-atlas-request-id': requestId,
    'x-atlas-provider': attempt.providerId,
    'x-atlas-model': attempt.model,
    'x-atlas-upstream-model': attempt.upstreamModel,
    'x-atlas-latency-ms': String(attempt.latencyMs ?? ''),
    'x-atlas-queue-wait-ms': String(attempt.queueWaitMs ?? '')
  };
}

function canFallback(status: number): boolean {
  return status >= 500 || status === 404 || status === 408 || status === 409;
}

function remainingTimeoutMs(context: ChatRequestContext, candidate: RouteCandidate): number {
  return Math.max(1, Math.min(candidate.provider.timeoutMs, context.deadlineAt - Date.now()));
}

function isDeadlineExpired(context: ChatRequestContext): boolean {
  return Date.now() >= context.deadlineAt;
}

function messageContent(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part?.text === 'string' ? part.text : '')
      .join('\n')
      .trim();
  }
  return '';
}

function compeatHeaders(requestId: string, winner: CompeatResult, results: CompeatResult[]): HeadersInit {
  return {
    'x-atlas-request-id': requestId,
    'x-atlas-strategy': 'compeat',
    'x-atlas-provider': winner.attempt.providerId,
    'x-atlas-model': winner.attempt.model,
    'x-atlas-upstream-model': winner.attempt.upstreamModel,
    'x-atlas-latency-ms': String(winner.attempt.latencyMs ?? ''),
    'x-atlas-queue-wait-ms': String(winner.attempt.queueWaitMs ?? ''),
    'x-atlas-compeat-winner-score': String(winner.score),
    'x-atlas-compeat-candidates': results.map((result) => `${result.attempt.providerId}:${result.score}`).join(',')
  };
}

function streamChunks(content: string): string[] {
  const chunks = content.match(/.{1,180}(\s|$)/gs);
  return chunks && chunks.length > 0 ? chunks.map((chunk) => chunk.trimStart()) : [content];
}

function openAIStreamFromWinner(requestId: string, winner: CompeatResult, results: CompeatResult[]): Response {
  const encoder = new TextEncoder();
  const payload = winner.payload ?? {};
  const id = String(payload.id ?? `chatcmpl-${randomUUID()}`);
  const created = Number(payload.created ?? Math.floor(Date.now() / 1000));
  const model = String(payload.model ?? winner.attempt.upstreamModel);
  const chunks = streamChunks(winner.content);

  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`));
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  });

  return new Response(body, {
    status: 200,
    headers: {
      ...compeatHeaders(requestId, winner, results),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    }
  });
}

async function runCompeatCandidate(
  candidate: RouteCandidate,
  context: ChatRequestContext,
  traceId: string
): Promise<CompeatResult> {
  try {
    const result = await forwardChatCompletion(
      candidate.provider,
      candidate.model.upstreamModel,
      { ...context.body, stream: false },
      context.headers,
      remainingTimeoutMs(context, candidate)
    );

    const attempt: UpstreamAttempt = {
      providerId: candidate.provider.id,
      model: candidate.model.id,
      upstreamModel: candidate.model.upstreamModel,
      status: result.response.status,
      latencyMs: result.latencyMs,
      queueWaitMs: result.queueWaitMs,
      error: result.response.ok ? null : await readError(result.response)
    };

    if (!result.response.ok) {
      updateCompeatCandidate(traceId, candidate.provider.id, {
        status: 'failed',
        score: 0,
        latencyMs: result.latencyMs,
        error: attempt.error,
        content: '',
        breakdown: null,
        completedAt: Date.now()
      });
      return { attempt, response: null, payload: null, content: '', score: 0, breakdown: null };
    }

    const payload = await result.response.clone().json() as any;
    const content = messageContent(payload);
    const breakdown = scoreCompeatCandidate(context.body, content, payload, result.latencyMs);
    const score = breakdown.score + Math.round(getProviderScore(candidate.provider.id) / 25);
    updateCompeatCandidate(traceId, candidate.provider.id, {
      status: 'completed',
      score,
      latencyMs: result.latencyMs,
      error: null,
      content,
      breakdown,
      completedAt: Date.now()
    });
    return {
      attempt,
      response: result.response,
      payload,
      content,
      score,
      breakdown
    };
  } catch (error) {
    const errorMessage = messageFromUnknown(error);
    updateCompeatCandidate(traceId, candidate.provider.id, {
      status: 'failed',
      score: 0,
      latencyMs: null,
      error: errorMessage,
      content: '',
      breakdown: null,
      completedAt: Date.now()
    });
    return {
      attempt: {
        providerId: candidate.provider.id,
        model: candidate.model.id,
        upstreamModel: candidate.model.upstreamModel,
        status: null,
        latencyMs: null,
        queueWaitMs: null,
        error: errorMessage
      },
      response: null,
      payload: null,
      content: '',
      score: 0,
      breakdown: null
    };
  }
}

function compeatCandidates(resolution: RouteResolution): RouteCandidate[] {
  const maxCompetitors = resolution.profile?.maxCompetitors ?? 3;
  const selected: RouteCandidate[] = [];
  const seenProviders = new Set<string>();

  for (const candidate of resolution.candidates) {
    if (isProviderCircuitOpen(candidate.provider.id)) continue;
    if (seenProviders.has(candidate.provider.id)) continue;
    selected.push(candidate);
    seenProviders.add(candidate.provider.id);
    if (selected.length >= maxCompetitors) break;
  }

  return selected;
}

async function routeCompeatCompletion(
  resolution: RouteResolution,
  context: ChatRequestContext
): Promise<ChatRouteResult> {
  const selected = compeatCandidates(resolution);
  const minCompetitors = resolution.profile?.minCompetitors ?? 2;

  if (selected.length < minCompetitors) {
    return {
      response: openAIError(`atlas/compeat requires at least ${minCompetitors} available providers`, 503, 'upstream_error', 'insufficient_competitors', 'model', { 'x-atlas-request-id': context.requestId }),
      attempts: []
    };
  }

  const traceId = `compeat-${context.requestId}`;
  startCompeatTrace({
    id: traceId,
    requestId: context.requestId,
    model: resolution.requestedModel,
    stream: context.body.stream === true,
    candidates: selected.map((candidate) => ({
      providerId: candidate.provider.id,
      model: candidate.model.id,
      upstreamModel: candidate.model.upstreamModel,
      status: 'pending',
      score: null,
      latencyMs: null,
      error: null,
      content: '',
      breakdown: null,
      completedAt: null
    }))
  });

  const results = await Promise.all(selected.map((candidate) => runCompeatCandidate(candidate, context, traceId)));
  const attempts = results.map((result) => result.attempt);
  const valid = results.filter((result) => result.response !== null && result.content.length > 0);

  if (valid.length === 0) {
    const lastAttempt = attempts.at(-1);
    finishCompeatTrace(traceId, { status: 'failed' });
    return {
      response: openAIError(lastAttempt?.error ?? 'All compeat candidates failed', 503, 'upstream_error', 'upstream_unavailable', 'model', { 'x-atlas-request-id': context.requestId }),
      attempts
    };
  }

  const winner = [...valid].sort((a, b) => b.score - a.score || (a.attempt.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.attempt.latencyMs ?? Number.MAX_SAFE_INTEGER))[0] as CompeatResult;
  finishCompeatTrace(traceId, { status: 'completed', winnerProviderId: winner.attempt.providerId, winnerModel: winner.attempt.model });

  if (context.body.stream) {
    return {
      response: openAIStreamFromWinner(context.requestId, winner, results),
      attempts
    };
  }

  return {
    response: Response.json(winner.payload, {
      status: winner.response?.status ?? 200,
      headers: compeatHeaders(context.requestId, winner, results)
    }),
    attempts
  };
}

export async function routeChatCompletion(
  resolution: RouteResolution,
  context: ChatRequestContext
): Promise<ChatRouteResult> {
  if (resolution.profile?.strategy === 'compeat') {
    return routeCompeatCompletion(resolution, context);
  }

  const attempts: UpstreamAttempt[] = [];
  const allowFallback = resolution.candidates.length > 1;

  for (const candidate of resolution.candidates) {
    if (isDeadlineExpired(context)) break;

    const providerAttempts = Math.max(1, candidate.provider.maxRetries + 1);

    for (let attemptIndex = 0; attemptIndex < providerAttempts; attemptIndex++) {
      if (isDeadlineExpired(context)) break;

      try {
        const result = await forwardChatCompletion(
          candidate.provider,
          candidate.model.upstreamModel,
          context.body,
          context.headers,
          remainingTimeoutMs(context, candidate)
        );

        const attempt: UpstreamAttempt = {
          providerId: candidate.provider.id,
          model: candidate.model.id,
          upstreamModel: candidate.model.upstreamModel,
          status: result.response.status,
          latencyMs: result.latencyMs,
          queueWaitMs: result.queueWaitMs,
          error: result.response.ok ? null : await readError(result.response)
        };

        attempts.push(attempt);

        if (result.response.ok) {
          return {
            response: responseFromUpstream(result.response, attemptHeaders(context.requestId, attempt)),
            attempts
          };
        }

        if (!isRetryableStatus(result.response.status)) {
          if (allowFallback && canFallback(result.response.status)) {
            break;
          }
          return {
            response: openAIError(attempt.error ?? 'Upstream rejected the request', result.response.status, 'upstream_error', candidate.provider.id, 'model', attemptHeaders(context.requestId, attempt)),
            attempts
          };
        }
      } catch (error) {
        attempts.push({
          providerId: candidate.provider.id,
          model: candidate.model.id,
          upstreamModel: candidate.model.upstreamModel,
          status: null,
          latencyMs: null,
          queueWaitMs: null,
          error: messageFromUnknown(error)
        });
      }

      if (attemptIndex < providerAttempts - 1) {
        await sleep(candidate.provider.retryDelayMs * (attemptIndex + 1));
      }
    }

    if (!allowFallback) break;
  }

  const lastAttempt = attempts.at(-1);
  return {
    response: openAIError(
      lastAttempt?.error ?? 'All upstream providers failed',
      503,
      'upstream_error',
      'upstream_unavailable',
      'model',
      { 'x-atlas-request-id': context.requestId }
    ),
    attempts
  };
}
