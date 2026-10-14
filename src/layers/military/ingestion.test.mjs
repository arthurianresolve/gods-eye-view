import test from 'node:test';
import assert from 'node:assert/strict';
import { createIngestion, createMilitaryFeed } from './ingestion.js';
function setup(source, callbacks = {}) {
  const feed = createMilitaryFeed(source);
  const accepted = [];
  const labels = [];
  const restores = [];
  const { methods } = createIngestion({
    feed,
    applySnapshot: (snapshot) => {
      accepted.push(snapshot);
      return { count: 1, ids: new Set(['aaa001']) };
    },
    setSourceLabel: (label) => labels.push(label),
    applyPendingTrackingRestore: () => restores.push(true),
    ...callbacks,
  });
  return { feed, accepted, labels, restores, update: methods.update };
}

test('military acquisition cancels late replies without publishing or restoring tracking', async () => {
  let release;
  let renderDemandSyncs = 0;
  const probe = setup(
    {
      getSnapshot: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    { syncRenderDemand: () => renderDemandSyncs++ },
  );
  const request = probe.update(null);
  assert.equal(probe.feed._activeUpdateControllers.size, 1);
  for (const controller of probe.feed._activeUpdateControllers)
    controller.abort();
  release({ records: [] });
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(probe.accepted.length, 0);
  assert.equal(probe.restores.length, 0);
  assert.equal(probe.feed._activeUpdateControllers.size, 0);
  assert.equal(renderDemandSyncs, 1, 'late cancellation reconciles its owner');
});

test('military ingestion reconciles render ownership after successful and failed snapshot application', async () => {
  let activeVisuals = false;
  const observed = [];
  const successful = setup(
    {
      async getSnapshot() {
        return {
          records: [],
          source: 'Fixture',
          observedAtMs: 1234,
          freshness: 'fresh',
        };
      },
    },
    {
      applySnapshot() {
        activeVisuals = true;
        return { count: 1, ids: new Set(['aaa001']) };
      },
      syncRenderDemand() {
        observed.push(activeVisuals);
      },
    },
  );
  await successful.update(null);
  assert.deepEqual(observed, [true, true]);

  const failed = setup(
    {
      async getSnapshot() {
        return {
          records: [],
          source: 'Fixture',
          observedAtMs: 1235,
          freshness: 'fresh',
        };
      },
    },
    {
      applySnapshot() {
        activeVisuals = false;
        throw new Error('fixture renderer failure');
      },
      syncRenderDemand() {
        observed.push(activeVisuals);
      },
    },
  );
  await failed.update(null);
  assert.deepEqual(observed, [true, true, false]);
});

test('military acquisition keeps the degraded source reason and respects retry admission', async () => {
  let calls = 0;
  const probe = setup({
    async getSnapshot() {
      calls++;
      return {
        records: [],
        source: 'Fixture',
        observedAtMs: 1234,
        freshness: 'stale',
        stale: true,
        reason: 'Upstream refreshing',
      };
    },
  });
  await probe.update(null);
  assert.equal(probe.feed._lastUpdate, 1234);
  assert.equal(probe.feed._lastError, 'Upstream refreshing');
  assert.equal(probe.feed._backoff, true);
  assert.deepEqual(probe.labels, ['Fixture']);
  probe.feed._retryAt = Date.now() + 60000;
  await probe.update(null);
  assert.equal(calls, 1);
  assert.equal(probe.restores.length, 1);
  assert.equal(
    probe.feed._lastTrackingRefreshOutcome.status,
    'source-unavailable',
  );
});

test('military render ownership reconciles immediately after applying membership', async () => {
  const order = [];
  const probe = setup(
    {
      async getSnapshot() {
        return {
          records: [],
          source: 'Fixture',
          observedAtMs: 1234,
          freshness: 'fresh',
        };
      },
    },
    {
      applySnapshot() {
        order.push('membership');
        return { count: 1, ids: new Set(['aaa001']) };
      },
      syncRenderDemand() {
        order.push('render-owner');
      },
      applyPendingTrackingRestore() {
        order.push('tracking-restore');
      },
    },
  );

  await probe.update(null);
  assert.deepEqual(order.slice(0, 3), [
    'membership',
    'render-owner',
    'tracking-restore',
  ]);
  assert.equal(
    order.at(-1),
    'render-owner',
    'terminal reconciliation still runs',
  );
});
