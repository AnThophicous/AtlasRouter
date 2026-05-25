import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptChatPayloadToResponse, getStoredResponse, responseRequestToChatRequest, storeResponse } from './responses.js';

test('responses adapter converts input and instructions into chat messages', () => {
  const adapted = responseRequestToChatRequest({
    model: 'atlas/auto',
    instructions: 'Be concise',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'hello' }
        ]
      }
    ]
  });

  assert.equal(adapted.messages[0]?.role, 'system');
  assert.equal(adapted.messages[1]?.role, 'user');
  assert.deepEqual(adapted.request.messages, adapted.messages);
  assert.equal(adapted.inputItems.length, 1);
});

test('responses adapter maps chat payload into responses payload and stores it', () => {
  const responseBody = adaptChatPayloadToResponse({
    id: 'chatcmpl_1',
    created: 123,
    model: 'atlas/auto',
    choices: [
      {
        message: {
          content: 'ok'
        }
      }
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 2,
      total_tokens: 12
    }
  }, 'atlas/auto');

  storeResponse(responseBody, [{ role: 'assistant', content: 'ok' }], [{ id: 'msg_input', type: 'message' }]);
  const stored = getStoredResponse(String(responseBody.id));

  assert.equal(responseBody.object, 'response');
  assert.ok(String(responseBody.id).startsWith('resp_'));
  assert.equal(responseBody.output_text, 'ok');
  assert.equal((responseBody.usage as Record<string, unknown>).total_tokens, 12);
  assert.ok(stored);
  assert.equal(stored?.messages[0]?.role, 'assistant');
  assert.equal(stored?.inputItems.length, 2);
});
