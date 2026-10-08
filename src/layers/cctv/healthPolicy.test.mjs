import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraHealthRank,
  isCameraEligibleForAutoSelection,
  isFreshCameraHealth,
} from './healthPolicy.js';

const now = 1_000_000;

test('declared cadence and independent decode failures guide selection until expiry', () => {
  const health = {
    status: 'ok',
    updatedAt: now,
    refreshIntervalMs: 1000,
    decodeStatus: 'failed',
    decodeAttemptedAt: now,
  };
  assert.equal(isCameraEligibleForAutoSelection(health, now + 2999), false);
  assert.equal(isCameraEligibleForAutoSelection(health, now + 3000), true);
  assert.equal(isFreshCameraHealth({ updatedAt: now + 1 }, now), false);
});

test('camera health becomes stale after five minutes when source cadence is unknown', () => {
  assert.equal(isFreshCameraHealth({ updatedAt: now - 299_999 }, now), true);
  assert.equal(isFreshCameraHealth({ updatedAt: now - 300_000 }, now), false);
  assert.equal(isFreshCameraHealth({ updatedAt: now - 300_001 }, now), false);
});

test('automatic selection excludes only fresh known failures and placeholders', () => {
  assert.equal(
    isCameraEligibleForAutoSelection(
      {
        status: 'degraded',
        reasonCode: 'synthetic-placeholder',
        updatedAt: now,
      },
      now,
    ),
    false,
  );
  assert.equal(
    isCameraEligibleForAutoSelection(
      { status: 'degraded', reasonCode: 'upstream-timeout', updatedAt: now },
      now,
    ),
    false,
  );
  assert.equal(
    isCameraEligibleForAutoSelection(
      { status: 'degraded', reasonCode: 'unknown', updatedAt: now },
      now,
    ),
    false,
  );
  assert.equal(
    isCameraEligibleForAutoSelection(
      {
        status: 'degraded',
        reasonCode: 'upstream-failure',
        updatedAt: now - 300_001,
      },
      now,
    ),
    true,
  );
  assert.equal(isCameraEligibleForAutoSelection(null, now), true);
});

test('healthy cameras win equal-distance tie breaks', () => {
  assert.equal(cameraHealthRank({ status: 'ok', updatedAt: now }, now), 0);
  assert.equal(
    cameraHealthRank({ status: 'degraded', updatedAt: now }, now),
    2,
  );
  assert.equal(cameraHealthRank(null, now), 1);
});
