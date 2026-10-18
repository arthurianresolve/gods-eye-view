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
      viewer: {
        resolutionScale: 0.5,
        scene: {
          globe: { maximumScreenSpaceError: 16 },
          canvas: { width: 1600, height: 1200 },
            context: { _originalGLContext: null },
        },
      },
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

test('page evaluate serialization does not depend on module bindings', () => {
  const serialized = Function(`return (${applyNativeSharpnessProfile.toString()})`)();
  const windowObject = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 2,
    __godsEyeView: {
      viewer: { scene: { globe: {}, canvas: { width: 1600, height: 1200 } } },
    },
  };
  assert.equal(serialized(windowObject).id, 'native-sharpness-v1');
});

test('native profile rejects a drawing buffer beyond the WebGL limit', () => {
  const gl = { MAX_VIEWPORT_DIMS: 1, getParameter: () => [100, 100] };
  assert.throws(
    () =>
      applyNativeSharpnessProfile({
        innerWidth: 100,
        innerHeight: 100,
        devicePixelRatio: 1,
        __godsEyeView: {
          viewer: {
            scene: { globe: {}, canvas: { width: 101, height: 100 }, context: { _originalGLContext: gl } },
          },
        },
      }),
    /exceeds WebGL viewport limit/,
  );
});
