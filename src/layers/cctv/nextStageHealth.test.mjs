import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  updateCctvHealth,
  cctvHealthWithStaleness,
} from '../../../server/providers/cctv.js';
import { createPlaceholderMatcher } from '../../../server/providers/cctv/placeholders.js';
import { fetchCctvImageFromUpstream } from '../../../server/providers/cctv/media.js';
import { createNavigation } from './navigation.js';

test('camera failure and recovery replace conclusions, retaining success history', () => {
  const good = updateCctvHealth(
    'one',
    {},
    { status: 'ok', sourceKind: 'snapshot' },
    1000,
  );
  const failed = updateCctvHealth(
    'one',
    good,
    { status: 'degraded', message: 'upstream timeout' },
    2000,
  );
  assert.equal(failed.reasonCode, 'upstream-timeout');
  assert.equal(failed.lastSuccessAt, 1000);
  const recovered = updateCctvHealth(
    'one',
    failed,
    { status: 'ok', sourceKind: 'snapshot' },
    3000,
  );
  assert.equal(recovered.reasonCode, 'delivery-ok');
  assert.equal(recovered.lastSuccessAt, 3000);
  assert.equal(recovered.message, '');
  assert.deepEqual(
    updateCctvHealth('one', recovered, { cancelled: true }, 4000),
    recovered,
  );
  assert.equal(
    cctvHealthWithStaleness({ ...failed, refreshIntervalMs: 1000 }, 5000)
      .status,
    'stale',
  );
});

test('verified placeholder fingerprints match only their provider and exact bytes', () => {
  const frame = Buffer.from('SYNTHETIC TEST PLACEHOLDER');
  const matcher = createPlaceholderMatcher([
    {
      provider: 'Fixture agency',
      sha256: createHash('sha256').update(frame).digest('hex'),
      verifiedAt: '2026-01-01T00:00:00Z',
      exampleUrl: 'https://example.test/fixture-verification',
    },
  ]);
  assert.equal(matcher('Fixture agency', frame), true);
  assert.equal(matcher('Other agency', frame), false);
  assert.equal(
    matcher('Fixture agency', Buffer.from('stationary road')),
    false,
  );
  const empty = createPlaceholderMatcher();
  for (let i = 0; i < 20; i++)
    assert.equal(empty('Fixture agency', frame), false);
  assert.throws(
    () =>
      createPlaceholderMatcher([
        { provider: 'Unverified', sha256: 'a'.repeat(64) },
      ]),
    /verification/,
  );
});

test('caller cancellation terminates a frame request without claiming a provider failure', async () => {
  const controller = new AbortController();
  const health = [];
  const pending = fetchCctvImageFromUpstream('https://example.test/camera', {
    signal: controller.signal,
    onHealth: (value) => health.push(value),
    fetchImpl: async (_url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      }),
  });
  controller.abort();
  assert.equal(await pending, null);
  assert.deepEqual(health, []);
});

test('automatic nearest camera filters decode failures, retains distance priority, and reports none', () => {
  const previous = globalThis.Cesium;
  globalThis.Cesium = { Math: { toDegrees: (x) => x } };
  try {
    const now = Date.now();
    const state = {
      _viewer: {
        camera: { positionCartographic: { latitude: 0, longitude: 0 } },
      },
      _records: ['failed', 'unknown', 'healthy'].map((id, i) => ({
        camera: { id, lat: i, lon: 0 },
      })),
      _healthById: new Map([
        ['failed', { decodeStatus: 'failed', decodeAttemptedAt: now }],
        ['healthy', { status: 'ok', updatedAt: now }],
      ]),
    };
    const navigation = createNavigation({
      state,
      parts: { model: { haversineKm: (_a, _b, lat) => lat } },
    });
    assert.equal(navigation.nearestCameraIdToViewer(), 'unknown');
    for (const record of state._records)
      state._healthById.set(record.camera.id, {
        status: 'degraded',
        updatedAt: now,
      });
    assert.equal(navigation.nearestCameraIdToViewer(), null);
  } finally {
    globalThis.Cesium = previous;
  }
});
