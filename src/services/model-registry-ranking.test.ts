import assert from 'node:assert/strict';
import test from 'node:test';
import { recordProviderFailure, recordProviderSuccess, resetProviderMetrics } from '../lib/provider-metrics.js';
import { resolveRoute } from './model-registry.js';

test('atlas auto reorders candidates based on runtime score', async () => {
  resetProviderMetrics();

  recordProviderFailure('deeps', 500, 100);
  recordProviderFailure('deeps', 500, 120);
  recordProviderFailure('deeps', 500, 140);
  recordProviderSuccess('qwen', 50);
  recordProviderSuccess('qwen', 40);

  const route = await resolveRoute('atlas/auto');

  assert.ok(route);
  assert.equal(route.candidates[0]?.provider.id, 'qwen');
});
