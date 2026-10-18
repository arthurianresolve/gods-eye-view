import assert from 'node:assert/strict';

export const NATIVE_SHARPNESS_PROFILE_ID = 'native-sharpness-v1';

/** Apply the declared comparison profile in the page before warmup begins. */
export function applyNativeSharpnessProfile(windowObject = globalThis.window) {
  const viewer = windowObject?.__godsEyeView?.viewer;
  const globe = viewer?.scene?.globe;
  if (!viewer || !globe)
    throw new Error('Native sharpness profile needs viewer.globe.');
  const canvas = viewer.scene.canvas;
  viewer.useBrowserRecommendedResolution = false;
  viewer.resolutionScale = 1;
  globe.maximumScreenSpaceError = 1;
  viewer.__gevNativeSharpnessProfile = 'native-sharpness-v1';
  return {
    id: 'native-sharpness-v1',
    useBrowserRecommendedResolution: viewer.useBrowserRecommendedResolution,
    resolutionScale: viewer.resolutionScale,
    maximumScreenSpaceError: globe.maximumScreenSpaceError,
    viewport: {
      width: canvas.clientWidth || windowObject.innerWidth,
      height: canvas.clientHeight || windowObject.innerHeight,
      dpr: windowObject.devicePixelRatio,
    },
    drawingBuffer: {
      width: canvas?.width,
      height: canvas?.height,
    },
  };
}

/** Validate an observed profile without weakening the requested quality. */
export function assertNativeSharpnessProfile(observed, label = 'scene') {
  const profile = observed?.environment?.nativeSharpnessProfile;
  if (!profile)
    throw new Error(`${label} is missing native sharpness profile.`);
  assert.equal(
    profile.id,
    NATIVE_SHARPNESS_PROFILE_ID,
    `${label} profile id differs`,
  );
  assert.equal(
    profile.useBrowserRecommendedResolution,
    false,
    `${label} browser resolution mode differs`,
  );
  assert.equal(profile.resolutionScale, 1, `${label} resolution scale differs`);
  assert.equal(
    profile.maximumScreenSpaceError,
    1,
    `${label} globe SSE differs`,
  );
  assert.ok(
    Number.isInteger(profile.viewport?.width) && profile.viewport.width > 0,
  );
  assert.ok(
    Number.isInteger(profile.viewport?.height) && profile.viewport.height > 0,
  );
  assert.ok(Number.isFinite(profile.viewport?.dpr) && profile.viewport.dpr > 0);
  assert.ok(
    Number.isInteger(profile.drawingBuffer?.width) &&
      profile.drawingBuffer.width > 0,
  );
  assert.ok(
    Number.isInteger(profile.drawingBuffer?.height) &&
      profile.drawingBuffer.height > 0,
  );
  // Cesium assigns CSS size * DPR to the canvas' unsigned integer dimensions.
  // HTML canvas conversion truncates positive fractional sizes (not rounding).
  const expectedWidth = Math.floor(
    profile.viewport.width * profile.viewport.dpr * profile.resolutionScale,
  );
  const expectedHeight = Math.floor(
    profile.viewport.height * profile.viewport.dpr * profile.resolutionScale,
  );
  assert.equal(
    profile.drawingBuffer.width,
    expectedWidth,
    `${label} drawing-buffer width differs from CSS viewport and DPR`,
  );
  assert.equal(
    profile.drawingBuffer.height,
    expectedHeight,
    `${label} drawing-buffer height differs from CSS viewport and DPR`,
  );
  return true;
}
