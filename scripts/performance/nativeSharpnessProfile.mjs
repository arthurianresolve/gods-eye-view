import assert from 'node:assert/strict';

export const NATIVE_SHARPNESS_PROFILE_ID = 'native-sharpness-v1';

/** Apply the declared comparison profile in the page before warmup begins. */
export function applyNativeSharpnessProfile(windowObject = globalThis.window) {
  const viewer = windowObject?.__godsEyeView?.viewer;
  const globe = viewer?.globe;
  if (!viewer || !globe) throw new Error('Native sharpness profile needs viewer.globe.');
  viewer.useBrowserRecommendedResolution = false;
  viewer.resolutionScale = 1;
  globe.maximumScreenSpaceError = 1;
  viewer.__gevNativeSharpnessProfile = NATIVE_SHARPNESS_PROFILE_ID;
  return {
    id: NATIVE_SHARPNESS_PROFILE_ID,
    useBrowserRecommendedResolution: viewer.useBrowserRecommendedResolution,
    resolutionScale: viewer.resolutionScale,
    maximumScreenSpaceError: globe.maximumScreenSpaceError,
    viewport: { width: windowObject.innerWidth, height: windowObject.innerHeight, dpr: windowObject.devicePixelRatio },
  };
}

/** Validate an observed profile without weakening the requested quality. */
export function assertNativeSharpnessProfile(observed, label = 'scene') {
  const profile = observed?.environment?.nativeSharpnessProfile;
  if (!profile) return false;
  assert.equal(profile.id, NATIVE_SHARPNESS_PROFILE_ID, `${label} profile id differs`);
  assert.equal(profile.useBrowserRecommendedResolution, false, `${label} browser resolution mode differs`);
  assert.equal(profile.resolutionScale, 1, `${label} resolution scale differs`);
  assert.equal(profile.maximumScreenSpaceError, 1, `${label} globe SSE differs`);
  assert.ok(Number.isInteger(profile.viewport?.width) && profile.viewport.width > 0);
  assert.ok(Number.isInteger(profile.viewport?.height) && profile.viewport.height > 0);
  assert.ok(Number.isFinite(profile.viewport?.dpr) && profile.viewport.dpr > 0);
  return true;
}
