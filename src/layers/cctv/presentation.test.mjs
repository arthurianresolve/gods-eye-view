import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresentation } from './presentation.js';

function cameraState({ feedType, projectionMode, health } = {}) {
  const record = {
    camera: {
      id: 'cam-1',
      name: 'Test Camera',
      city: 'Test City',
      provider: 'Test provider',
      lat: 1,
      lon: 2,
      headingDeg: 90,
      pitchDeg: 0,
      fovDeg: 60,
      rangeM: 100,
      absoluteHeightM: 10,
      mountHeightM: 2,
      feedType,
    },
    projection: projectionMode ? { mode: projectionMode } : null,
  };
  const presentation = createPresentation({
    state: { _healthById: new Map(health ? [['cam-1', health]] : []) },
    parts: {
      model: {
        isVideoFeedType: (type) => ['mp4', 'hls', 'webm'].includes(type),
      },
      calibration: {
        normalizeCalibration: () => ({}),
        deriveCalBadge: () => 'unknown',
      },
      frames: { frameUrlFor: () => '/frame', mediaUrlFor: () => '/media' },
    },
  });
  return presentation.getPublicCameraState(record, 'cam-1');
}

test('a failed live video feed is exposed as a still fallback, not video', () => {
  const fallback = cameraState({ feedType: 'hls', projectionMode: 'image' });
  assert.equal(fallback.isVideo, false);
  assert.equal(fallback.videoFallback, true);

  const live = cameraState({ feedType: 'hls', projectionMode: 'video' });
  assert.equal(live.isVideo, true);
  assert.equal(live.videoFallback, false);

  const still = cameraState({ feedType: 'image', projectionMode: 'image' });
  assert.equal(still.isVideo, false);
  assert.equal(still.videoFallback, false);
});

test('camera evidence exposes redacted health and browser decode facts', () => {
  const state = cameraState({
    feedType: 'image',
    projectionMode: 'image',
    health: {
      status: 'degraded',
      reasonCode: 'upstream-failure',
      message: 'fetch https://private.example.test/cam from 10.0.0.4 failed',
      attemptedAt: 2_000,
      lastSuccessAt: 1_000,
      decodeStatus: 'failed',
      decodeReason: 'decode-failure',
      decodeAttemptedAt: 2_100,
      decodeLastSuccessAt: 1_100,
    },
  });
  assert.equal(state.healthReason, 'upstream-failure');
  assert.equal(state.healthDiagnostic, 'fetch [url] from [address] failed');
  assert.equal(state.decodeReason, 'decode-failure');
  assert.equal(state.decodeLastSuccessAt, 1_100);
  assert.equal(state.evidence.observedAt, null);
});
