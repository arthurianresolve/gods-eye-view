import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayerCapabilityRegistry } from './capabilities.js';

test('live-only data never masquerades as a historical sample', async () => {
  const registry = createLayerCapabilityRegistry();
  registry.register({
    id: 'flights',
    mode: 'live',
    readLive: () => ({ sampleTimeMs: 1000 }),
  });
  assert.deepEqual(await registry.resolveAt('flights', null), {
    status: 'available',
    layerId: 'flights',
    mode: 'live',
    sampleTimeMs: 1000,
  });
  assert.deepEqual(await registry.resolveAt('flights', 1000), {
    status: 'unsupported',
    reason: 'live-only',
    layerId: 'flights',
  });
  assert.equal(
    (await registry.resolveAt('missing', null)).reason,
    'unregistered-layer',
  );
  registry.destroy();
});

test('recorded adapters report no coverage and retain actual sample time', async () => {
  const registry = createLayerCapabilityRegistry();
  registry.register({
    id: 'recording',
    mode: 'recorded',
    coverage: { from: 1000, to: 3000 },
    selectAt: async ({ targetMs }) => ({
      sampleTimeMs: targetMs - 100,
      value: 'recorded',
    }),
  });
  assert.equal(
    (await registry.resolveAt('recording', 999)).status,
    'no-coverage',
  );
  assert.deepEqual(await registry.resolveAt('recording', 2000), {
    status: 'available',
    layerId: 'recording',
    mode: 'recorded',
    targetMs: 2000,
    sampleTimeMs: 1900,
    value: 'recorded',
  });
  assert.equal(
    (await registry.resolveAt('recording', 2000)).sampleTimeMs <= 2000,
    true,
  );
  registry.destroy();
});

test('future and invalid samples cannot leak into an investigation time', async () => {
  const registry = createLayerCapabilityRegistry();
  registry.register({
    id: 'history',
    mode: 'provider-history',
    coverage: { from: 0, to: 10_000 },
    selectAt: async () => ({ sampleTimeMs: 5000 }),
  });
  assert.equal(
    (await registry.resolveAt('history', 4000)).status,
    'invalid-sample-time',
  );
  assert.equal(
    (await registry.resolveAt('history', 'not-a-date')).status,
    'invalid-time',
  );
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await registry.resolveAt('history', 4000, { signal: controller.signal }))
      .status,
    'cancelled',
  );
  registry.destroy();
});

test('resolution batches cancel if capability changes while a selection is pending', async () => {
  const registry = createLayerCapabilityRegistry();
  let finish;
  registry.register({
    id: 'slow',
    mode: 'recorded',
    coverage: { from: 0, to: 10_000 },
    selectAt: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const result = registry.resolveAllAt(5000);
  await Promise.resolve();
  registry.register({ id: 'other', mode: 'static' });
  finish({ sampleTimeMs: 4500 });
  assert.deepEqual(await result, { status: 'cancelled', generation: 2 });
  registry.destroy();
});
