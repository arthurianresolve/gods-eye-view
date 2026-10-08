import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresentation } from './presentation.js';

function cameraState({ feedType, projectionMode }) {
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
    state: { _healthById: new Map() },
    parts: {
      model: { isVideoFeedType: (type) => ['mp4', 'hls', 'webm'].includes(type) },
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
