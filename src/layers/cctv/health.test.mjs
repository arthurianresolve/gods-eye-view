import assert from 'node:assert/strict';
import test from 'node:test';
import { createHealth } from './health.js';

test('browser decode health supplements proxy health across refreshes', async () => {
  const state = {
    _clientHealthById: new Map(),
    _healthById: new Map(),
    _lastHealthSyncAt: 0,
    _sourceAbort: new AbortController(),
  };
  const health = createHealth({
    state,
    parts: {
      model: { safeNumber: (value, fallback) => Number(value) || fallback },
    },
    source: {
      getHealth: async () => ({
        cameras: [
          {
            id: 'cam-1',
            status: 'degraded',
            sourceKind: 'upstream',
            reasonCode: 'upstream-failure',
            message: 'Upstream failed',
            updatedAt: 1_000,
          },
        ],
      }),
    },
  });
  await health.syncHealthState(true);
  health.recordClientHealth('cam-1', {
    status: 'failed',
    reasonCode: 'decode-failure',
    attemptedAt: 2_000,
  });
  assert.equal(state._healthById.get('cam-1').reasonCode, 'upstream-failure');
  assert.equal(state._healthById.get('cam-1').decodeReason, 'decode-failure');
  await health.syncHealthState(true);
  assert.equal(state._healthById.get('cam-1').decodeReason, 'decode-failure');
});
