import assert from 'node:assert/strict';
import test from 'node:test';
import { resetProviderMetrics } from '../lib/provider-metrics.js';
import { listPublicModels, resolveRoute } from './model-registry.js';

test('public models include default router profiles and hide disabled-only profiles', async () => {
  process.env.MIMO_ENABLED = 'false';
  process.env.Z2API_ENABLED = 'false';

  const models = await listPublicModels();
  const ids = models.map((model) => model.id);

  assert.ok(ids.includes('atlas/auto'));
  assert.ok(ids.includes('atlas/reasoning'));
  assert.equal(ids.includes('atlas/vision'), false);
  assert.equal(ids.includes('mimo-v2.5-pro'), false);
  assert.equal(ids.includes('glm-4.7'), false);
});

test('aliases resolve to the expected upstream model', async () => {
  const route = await resolveRoute('deepseek-thinking');

  assert.ok(route);
  assert.equal(route.candidates[0]?.provider.id, 'deeps');
  assert.equal(route.candidates[0]?.model.upstreamModel, 'deepseek-v4-flash-thinking');
});

test('virtual profiles resolve multiple ordered candidates', async () => {
  resetProviderMetrics();
  const route = await resolveRoute('atlas/auto');

  assert.ok(route);
  assert.ok(route.candidates.length >= 3);
  assert.equal(route.candidates[0]?.provider.id, 'deeps');
});

test('compeat profile requires multiple providers and uses competition strategy', async () => {
  resetProviderMetrics();
  const route = await resolveRoute('atlas/compeat');

  assert.ok(route);
  assert.equal(route.profile?.strategy, 'compeat');
  assert.equal(route.profile?.minCompetitors, 2);
  assert.ok(new Set(route.candidates.map((candidate) => candidate.provider.id)).size >= 2);
});
