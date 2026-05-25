import assert from 'node:assert/strict';
import test from 'node:test';
import { sleep } from './http.js';
import { withProviderSlot } from './provider-queue.js';

test('provider queue serializes requests for the same provider', async () => {
  const events: string[] = [];

  const first = withProviderSlot('qwen', 1, 1000, async () => {
    events.push('first-start');
    await sleep(75);
    events.push('first-end');
    return 'first';
  });

  const second = withProviderSlot('qwen', 1, 1000, async () => {
    events.push('second-start');
    events.push('second-end');
    return 'second';
  });

  const results = await Promise.all([first, second]);

  assert.deepEqual(results, ['first', 'second']);
  assert.deepEqual(events, ['first-start', 'first-end', 'second-start', 'second-end']);
});

test('provider queue allows parallel execution across providers', async () => {
  const events: string[] = [];

  const a = withProviderSlot('deeps', 1, 1000, async () => {
    events.push('deeps-start');
    await sleep(50);
    events.push('deeps-end');
    return 'a';
  });

  const b = withProviderSlot('kimi', 1, 1000, async () => {
    events.push('kimi-start');
    await sleep(50);
    events.push('kimi-end');
    return 'b';
  });

  const results = await Promise.all([a, b]);

  assert.deepEqual(results, ['a', 'b']);
  assert.ok(events.indexOf('deeps-start') !== events.indexOf('kimi-start'));
});
