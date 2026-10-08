import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CCTV_HEALTH_STALE_MS,
  cctvHealthReasonCode,
  cctvHealthWithStaleness,
} from './cctv.js';

test('CCTV health reasons distinguish transport, decode, fallback and placeholders', () => {
  assert.equal(
    cctvHealthReasonCode({ status: 'degraded', message: 'Upstream HTTP 503' }),
    'upstream-failure',
  );
  assert.equal(
    cctvHealthReasonCode({ status: 'degraded', message: 'upstream timeout' }),
    'upstream-timeout',
  );
  assert.equal(
    cctvHealthReasonCode({ status: 'degraded', message: 'JPEG decode failed' }),
    'decode-failure',
  );
  assert.equal(
    cctvHealthReasonCode({ status: 'degraded', sourceKind: 'synthetic' }),
    'synthetic-placeholder',
  );
  assert.equal(
    cctvHealthReasonCode({ status: 'degraded', sourceKind: 'streetview' }),
    'fallback-streetview',
  );
});

test('CCTV health expires after three declared refresh intervals', () => {
  const now = 2_000_000;
  const fresh = {
    id: 'cam-1',
    status: 'degraded',
    reasonCode: 'upstream-failure',
    updatedAt: now - CCTV_HEALTH_STALE_MS,
  };
  assert.equal(cctvHealthWithStaleness(fresh, now).status, 'degraded');
  const stale = cctvHealthWithStaleness(
    { ...fresh, updatedAt: now - CCTV_HEALTH_STALE_MS - 1 },
    now,
  );
  assert.equal(stale.status, 'stale');
  assert.equal(stale.reasonCode, 'stale-health');
  assert.notEqual(stale, fresh);
});
