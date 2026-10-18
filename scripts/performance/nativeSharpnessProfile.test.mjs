import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyNativeSharpnessProfile,
  assertNativeSharpnessProfile,
} from './nativeSharpnessProfile.mjs';

test('native profile fixes Cesium resolution and records actual viewport inputs', () => {
  const windowObject = {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 1.25,
    __godsEyeView: {
      viewer: { resolutionScale: 0.5, globe: { maximumScreenSpaceError: 16 } },
    },
  };
  const applied = applyNativeSharpnessProfile(windowObject);
  assert.equal(applied.resolutionScale, 1);
  assert.equal(applied.maximumScreenSpaceError, 1);
  assert.equal(applied.viewport.dpr, 1.25);
  const observed = {
    environment: { nativeSharpnessProfile: applied },
  };
  assert.equal(assertNativeSharpnessProfile(observed), true);
});

test('native profile rejects a quality mismatch', () => {
  assert.throws(
    () =>
      assertNativeSharpnessProfile({
        environment: {
          nativeSharpnessProfile: {
            id: 'native-sharpness-v1',
            useBrowserRecommendedResolution: true,
            resolutionScale: 1,
            maximumScreenSpaceError: 1,
            viewport: { width: 1, height: 1, dpr: 1 },
          },
        },
      }),
    /browser resolution mode differs/,
  );
});
