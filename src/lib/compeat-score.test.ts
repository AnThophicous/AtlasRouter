import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenAIRequest } from '../types/openai.js';
import { scoreCompeatCandidate } from './compeat-score.js';

const body: OpenAIRequest = {
  model: 'atlas/compeat',
  messages: [
    {
      role: 'user',
      content: 'Responda em português com exatamente 3 bullets concretos sobre monitoramento de falhas.'
    }
  ]
};

test('compeat scorer rewards prompt format alignment and penalizes fake research markers', () => {
  const aligned = scoreCompeatCandidate(body, '- Mostre providers offline.\n- Mostre latência por provider.\n- Mostre o vencedor da comparação.', { choices: [{ finish_reason: 'stop' }] }, 1000);
  const suspicious = scoreCompeatCandidate(body, 'SEARCH talvez isso use [citation:1] e provavelmente precisa ver documentação.', { choices: [{ finish_reason: 'stop' }] }, 1000);

  assert.ok(aligned.score > suspicious.score);
  assert.equal(aligned.formatAlignment, 1);
  assert.ok(suspicious.safety < aligned.safety);
});
