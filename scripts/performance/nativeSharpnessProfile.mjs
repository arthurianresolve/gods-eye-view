import assert from 'node:assert/strict';

export const NATIVE_SHARPNESS_PROFILE_ID = 'native-sharpness-v1';

/** Apply the declared comparison profile in the page before warmup begins. */
export function applyNativeSharpnessProfile(windowObject = globalThis.window) {
  const viewer = windowObject?.__godsEyeView?.viewer;
  const globe = viewer?.scene?.globe;
  if (!viewer || !globe) throw new Error('Native sharpness profile needs viewer.globe.');
  const canvas = viewer.scene.canvas;
  const gl = viewer.scene.context?._originalGLContext;
  const maxViewport = gl?.getParameter?.(gl.MAX_VIEWPORT_DIMS);
  if (
    maxViewport &&
    (canvas.width > maxViewport[0] || canvas.height > maxViewport[1])
  )
    throw new Error(
      `Native sharpness profile exceeds WebGL viewport limit ${maxViewport[0]}x${maxViewport[1]}.`,
    );
  viewer.useBrowserRecommendedResolution = false;
  viewer.resolutionScale = 1;
  globe.maximumScreenSpaceError = 1;
  viewer.__gevNativeSharpnessProfile = 'native-sharpness-v1';
  return {
    id: 'native-sharpness-v1',
    useBrowserRecommendedResolution: viewer.useBrowserRecommendedResolution,
    resolutionScale: viewer.resolutionScale,
    maximumScreenSpaceError: globe.maximumScreenSpaceError,
    viewport: { width: windowObject.innerWidth, height: windowObject.innerHeight, dpr: windowObject.devicePixelRatio },
    drawingBuffer: {
      width: canvas?.width,
      height: canvas?.height,
    },
    maxViewportDimensions: maxViewport
      ? { width: maxViewport[0], height: maxViewport[1] }
      : null,
  };
}

/** Validate an observed profile without weakening the requested quality. */
export function assertNativeSharpnessProfile(observed, label = 'scene') {
  const profile = observed?.environment?.nativeSharpnessProfile;
  if (!profile) throw new Error(`${label} is missing native sharpness profile.`);
  assert.equal(profile.id, NATIVE_SHARPNESS_PROFILE_ID, `${label} profile id differs`);
  assert.equal(profile.useBrowserRecommendedResolution, false, `${label} browser resolution mode differs`);
  assert.equal(profile.resolutionScale, 1, `${label} resolution scale differs`);
  assert.equal(profile.maximumScreenSpaceError, 1, `${label} globe SSE differs`);
  assert.ok(Number.isInteger(profile.viewport?.width) && profile.viewport.width > 0);
  assert.ok(Number.isInteger(profile.viewport?.height) && profile.viewport.height > 0);
  assert.ok(Number.isFinite(profile.viewport?.dpr) && profile.viewport.dpr > 0);
  assert.ok(Number.isInteger(profile.drawingBuffer?.width) && profile.drawingBuffer.width > 0);
  assert.ok(Number.isInteger(profile.drawingBuffer?.height) && profile.drawingBuffer.height > 0);
  if (profile.maxViewportDimensions) {
    assert.ok(profile.drawingBuffer.width <= profile.maxViewportDimensions.width);
    assert.ok(profile.drawingBuffer.height <= profile.maxViewportDimensions.height);
  }
  return true;
}
