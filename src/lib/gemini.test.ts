import assert from 'node:assert/strict';
import test from 'node:test';
import { chatPayloadToGeminiResponse, geminiRequestToChatRequest, normalizeGeminiModel } from './gemini.js';

test('gemini adapter normalizes atlas model aliases', () => {
  assert.equal(normalizeGeminiModel('atlas-auto'), 'atlas/auto');
  assert.equal(normalizeGeminiModel('atlas%2Fcompeat'), 'atlas/compeat');
});

test('gemini adapter converts generateContent request into chat request', () => {
  const request = geminiRequestToChatRequest({
    contents: [
      {
        role: 'user',
        parts: [{ text: 'hello' }]
      }
    ],
    generationConfig: {
      maxOutputTokens: 20,
      temperature: 0.2
    }
  }, 'atlas/auto');

  assert.equal(request.model, 'atlas/auto');
  assert.equal(request.messages[0]?.role, 'user');
  assert.equal(request.max_tokens, 20);
  assert.equal(request.temperature, 0.2);
});

test('gemini adapter maps chat payload into generateContent response', () => {
  const response = chatPayloadToGeminiResponse({
    model: 'atlas/auto',
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
  }, 'atlas/auto');

  const candidates = response.candidates as Array<Record<string, any>>;
  assert.equal(candidates[0]?.content.parts[0].text, 'ok');
  assert.equal((response.usageMetadata as Record<string, unknown>).totalTokenCount, 3);
});
