import test from 'node:test';
import assert from 'node:assert/strict';
import { createIngestion } from './ingestion.js';

function setup(source, callbacks = {}) {
  const feed = {
    _source: source,
    _activeUpdateControllers: new Set(),
    _trackingRefreshEpoch: 0,
    _lastSource: 'Fixture',
    _lastCoverage: 'local',
    _retryAt: 0,
  };
  const accepted = [];
  const labels = [];
  const restores = [];
  const { methods } = createIngestion({
    feed,
    getQuery: () => ({ latitude: 39 }),
    applySnapshot: (snapshot) => {
      accepted.push(snapshot);
      return { count: 2, ids: new Set(['abc123']) };
    },
    setSourceLabel: (label) => labels.push(label),
    applyPendingTrackingRestore: () => restores.push(true),
    ...callbacks,
  });
  return { feed, accepted, labels, restores, update: methods.update };
}

test('civil acquisition rejects late completion after cancellation without publishing records', async () => {
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

test('civil ingestion reconciles render ownership after snapshot and renderer failures', async () => {
  let activeVisuals = false;
  const observed = [];
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
        activeVisuals = true;
        return { count: 1, ids: new Set(['abc123']) };
      },
      syncRenderDemand() {
        observed.push(activeVisuals);
      },
    },
  );
  await probe.update(null);
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

test('civil acquisition publishes source time and uses a replaced source on the next request', async () => {
  let calls = 0;
  const probe = setup({
    async getSnapshot(query) {
      assert.equal(query.latitude, 39);
      calls += 1;
      return {
        records: [],
        source: 'First',
        observedAtMs: 1234,
        freshness: 'fresh',
        coverage: 'worldwide',
      };
    },
  });
  await probe.update(null);
  assert.equal(probe.feed._lastUpdate, 1234);
  assert.equal(probe.feed._count, 2);
  assert.deepEqual([...probe.feed._lastTrackingRefreshOutcome.ids], ['abc123']);
  probe.feed._source = {
    async getSnapshot() {
      return {
        records: [],
        source: 'Second',
        observedAtMs: 1250,
        freshness: 'unknown',
      };
    },
  };
  await probe.update(null);
  assert.equal(calls, 1);
  assert.equal(probe.feed._lastUpdate, 1250);
  assert.equal(probe.feed._backoff, true);
  assert.equal(probe.feed._lastError, 'Source snapshot time unavailable');
  assert.deepEqual(probe.labels, ['First', 'Second']);
  assert.equal(probe.restores.length, 2);
});

test('accepted civil snapshots reach the optional recording owner after rendering', async () => {
  const order = [];
  const snapshot = {
    records: [],
    source: 'approved-fixture',
    observedAtMs: 1234,
    freshness: 'current',
  };
  const probe = setup(
    { getSnapshot: async () => snapshot },
    {
      onAcceptedSnapshot: async (value) => {
        assert.equal(value, snapshot);
        order.push('record');
      },
    },
  );
  await probe.update(null);
  assert.deepEqual(order, ['record']);
  assert.equal(probe.accepted[0], snapshot);
});

test('civil render ownership reconciles before slow snapshot recording completes', async () => {
  let releaseRecording;
  let notifyApplied;
  const order = [];
  const applied = new Promise((resolve) => {
    notifyApplied = resolve;
  });
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
        notifyApplied();
        return { count: 1, ids: new Set(['abc123']) };
      },
      syncRenderDemand() {
        order.push('render-owner');
      },
      onAcceptedSnapshot() {
        order.push('recording-started');
        return new Promise((resolve) => {
          releaseRecording = resolve;
        });
      },
    },
  );

  let settled = false;
  const update = probe.update(null).finally(() => {
    settled = true;
  });
  await applied;
  await Promise.resolve();
  assert.deepEqual(order.slice(0, 3), [
    'membership',
    'render-owner',
    'recording-started',
  ]);
  assert.equal(
    settled,
    false,
    'recording remains pending after ownership is acquired',
  );

  releaseRecording();
  await update;
  assert.equal(
    order.at(-1),
    'render-owner',
    'final reconciliation observes follow-up work',
  );
});
