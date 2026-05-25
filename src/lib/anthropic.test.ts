import assert from 'node:assert/strict';
import test from 'node:test';
import { anthropicRequestToChatRequest, chatPayloadToAnthropicMessage } from './anthropic.js';

test('anthropic adapter converts messages request into chat request', () => {
  const request = anthropicRequestToChatRequest({
    model: 'atlas/auto',
    system: 'Be concise',
    max_tokens: 30,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] }
    ]
  });

  assert.equal(request.messages[0]?.role, 'system');
  assert.equal(request.messages[1]?.role, 'user');
  assert.equal(request.max_tokens, 30);
});

test('anthropic adapter maps chat payload into message response', () => {
  const message = chatPayloadToAnthropicMessage({
    model: 'atlas/auto',
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 2 }
  }, 'atlas/auto');

  assert.equal(message.type, 'message');
  assert.equal(message.role, 'assistant');
  assert.equal((message.content as Array<Record<string, unknown>>)[0]?.text, 'ok');
  assert.equal((message.usage as Record<string, unknown>).output_tokens, 2);
});
