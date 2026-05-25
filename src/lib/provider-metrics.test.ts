import assert from 'node:assert/strict';
import test from 'node:test';
import { getProviderScore, isProviderCircuitOpen, recordProviderFailure, recordProviderSuccess, resetProviderMetrics } from './provider-metrics.js';

test('provider metrics opens and closes circuit after failures and success', () => {
  resetProviderMetrics();

  recordProviderFailure('deeps', 500, 100);
  recordProviderFailure('deeps', 500, 100);
  recordProviderFailure('deeps', 500, 100);

  assert.equal(isProviderCircuitOpen('deeps'), true);
  assert.equal(getProviderScore('deeps'), 0);

  recordProviderSuccess('deeps', 50);

  assert.equal(isProviderCircuitOpen('deeps'), false);
  assert.ok(getProviderScore('deeps') > 0);

  resetProviderMetrics();
});
