import * as Cesium from 'cesium';
import { cameraHue, viewshedColors } from '../../src/data/cctvViewshed.js';

const SHA256 = /^[a-f0-9]{64}$/i;
const SHA1 = /^[a-f0-9]{40}$/i;
export const CCTV_VIEWSHED_RETENTION_FIXTURE_ID = 'cctv-viewshed-retention/v2';
export const CCTV_VIEWSHED_RETENTION_CAMERA_COUNT = 16;
export const CCTV_VIEWSHED_RETENTION_LIMIT = 14;
export const CCTV_VIEWSHED_RETENTION_FIXTURE_SHA256 =
  'b160b49c242372d38b4cc5731f9d58934d11ced45a0c4da815a84a161a2897e0';
export const CCTV_VIEWSHED_RETENTION_FIXTURE_DESCRIPTOR = Object.freeze({
  fixtureId: 'cctv-viewshed-retention/v2',
  cameraIds: Object.freeze(
    Array.from(
      { length: CCTV_VIEWSHED_RETENTION_CAMERA_COUNT },
      (_, index) => `qa-viewshed-camera-${String(index).padStart(2, '0')}`,
    ),
  ),
  camera: Object.freeze({
    id: 'qa-cctv-calibration-camera-001',
    name: 'Calibration demand fixture',
    city: 'Austin',
    cityId: 'austin',
    lat: 30.2672,
    lon: -97.7431,
    headingDeg: 0,
    fovDeg: 70,
    rangeM: 700,
    mountHeightM: 22,
    pitchDeg: -17,
    groundElevationM: 0,
    feedType: 'image',
    provider: 'Synthetic CCTV fixture',
    sourceKind: 'synthetic',
    url: 'fixture://cctv-calibration-frame',
  }),
  frameDataSha256:
    '33934bce268c7686ea40866b64f6d3b02e1a0696ebd426547e05a557bd378d15',
  cameraLayout: Object.freeze({ gridColumns: 4, stepDegrees: 0.00035 }),
  epochMs: 1_791_460_800_000,
  viewport: Object.freeze([1200, 960]),
  settings: Object.freeze({
    coverageMode: 'viewshed',
    showProjection: false,
    autoHop: false,
    requestRenderMode: true,
    drawingBuffer: Object.freeze([1200, 800]),
  }),
});
export const CCTV_VIEWSHED_RETENTION_MODES = Object.freeze([
  'viewshed',
  'on',
  'off',
  'viewshed',
  'on',
  'off',
  'viewshed',
]);

function fail(message) {
  throw new Error(`CCTV viewshed retention ${message}.`);
}

function finite(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isFinite(value) || value < min || value > max)
    fail(`${label} is invalid`);
}

function count(value, label, { min = 0, max = 100_000 } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label} count is invalid`);
}

function digest(value, label, pattern = SHA256) {
  if (typeof value !== 'string' || !pattern.test(value))
    fail(`${label} digest is missing`);
}

function sameNumbers(actual, expected, label) {
  if (
    !Array.isArray(actual) ||
    !Array.isArray(expected) ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  )
    fail(`${label} differs from its declared value`);
}

function pixelSummary(value, label) {
  if (!value || typeof value !== 'object') fail(`${label} pixels are missing`);
  count(value.width, `${label} pixel width`, { min: 320, max: 4096 });
  count(value.height, `${label} pixel height`, { min: 240, max: 4096 });
  count(value.frameBefore, `${label} frame before`);
  count(value.frameAfter, `${label} frame after`, {
    min: value.frameBefore + 1,
  });
  digest(value.rgbaSha256, `${label} framebuffer`);
  count(value.nonBackgroundPixels, `${label} non-background pixel`, {
    min: 50,
    max: value.width * value.height,
  });
  count(value.distinctRgbSamples, `${label} distinct RGB`, {
    min: 2,
    max: 32,
  });
}

function cameraPose(value, label) {
  if (!value || typeof value !== 'object')
    fail(`${label} camera pose is missing`);
  for (const field of ['longitude', 'latitude', 'height', 'heading', 'pitch'])
    finite(value[field], `${label} camera ${field}`, {
      min: field === 'height' ? 0 : -1_000,
      max: field === 'height' ? 100_000 : 1_000,
    });
}

function rgba(value, label) {
  if (!Array.isArray(value) || value.length !== 4)
    fail(`${label} RGBA is invalid`);
  for (const channel of value)
    count(channel, `${label} RGBA channel`, { max: 255 });
}

function expectedFillRgba(cameraId, active, cameraIds) {
  const sortedIds = [...cameraIds].sort();
  const colors = viewshedColors(cameraHue(sortedIds.indexOf(cameraId)));
  return Array.from(
    Cesium.ColorGeometryInstanceAttribute.fromColor(
      active ? colors.fillActive : colors.fill,
    ).value,
  );
}

/** Strictly validate the bounded rendered component report. */
export function validateCctvViewshedRetentionReport(
  report,
  { expectedCommit } = {},
) {
  if (!report || report.schema !== 'gev-cctv-viewshed-retention/v2')
    fail('report schema is invalid');
  if (report.status !== 'passed') fail('report did not pass');
  if (report.phase !== 'complete') fail('report did not reach completion');
  if (report.performanceAcceptanceEligible !== false)
    fail('component result must remain comparison-ineligible');
  if (report.pixelFailureEvidence !== null)
    fail('passed report contains failure-only pixel evidence');
  if (report.scope !== 'rendered CCTV component retention comparison')
    fail('scope label is invalid');
  if (
    !SHA1.test(report.applicationCommit || '') ||
    !SHA1.test(report.harnessCommit || '')
  )
    fail('source identity is invalid');
  if (report.applicationCommit !== report.harnessCommit)
    fail('application and harness commits differ');
  if (
    expectedCommit &&
    (report.applicationCommit !== expectedCommit ||
      report.harnessCommit !== expectedCommit)
  )
    fail('application or harness commit differs from the requested commit');
  if (
    typeof report.environment?.renderer !== 'string' ||
    report.environment.renderer.length < 1 ||
    report.environment.renderer.length > 240
  )
    fail('renderer identity is unavailable');
  const fixture = report.fixture;
  if (fixture?.id !== CCTV_VIEWSHED_RETENTION_FIXTURE_ID)
    fail('fixture identity is invalid');
  if (
    fixture.sha256 !== CCTV_VIEWSHED_RETENTION_FIXTURE_SHA256 ||
    JSON.stringify(fixture.descriptor) !==
      JSON.stringify(CCTV_VIEWSHED_RETENTION_FIXTURE_DESCRIPTOR)
  )
    fail('fixture source differs from its pinned descriptor');
  count(fixture.cameraCount, 'camera', {
    min: CCTV_VIEWSHED_RETENTION_CAMERA_COUNT,
    max: CCTV_VIEWSHED_RETENTION_CAMERA_COUNT,
  });
  if (
    !Array.isArray(fixture.cameraIds) ||
    fixture.cameraIds.length !== fixture.cameraCount
  )
    fail('camera identity list is invalid');
  if (new Set(fixture.cameraIds).size !== fixture.cameraIds.length)
    fail('camera identity list contains duplicates');
  if (
    fixture.cameraIds.some(
      (id, index) =>
        id !== `qa-viewshed-camera-${String(index).padStart(2, '0')}`,
    )
  )
    fail('camera identity list differs from the fixed fixture');

  const settings = report.settings;
  count(settings?.drawingBufferWidth, 'drawing buffer width', {
    min: 1200,
    max: 1200,
  });
  count(settings?.drawingBufferHeight, 'drawing buffer height', {
    min: 800,
    max: 800,
  });
  count(settings?.viewportWidth, 'viewport width', { min: 1200, max: 1200 });
  count(settings?.viewportHeight, 'viewport height', { min: 960, max: 960 });
  count(settings?.msaaSamples, 'MSAA sample', { min: 4, max: 4 });
  if (
    settings?.coverageMode !== 'viewshed' ||
    settings.showProjection !== false ||
    settings.autoHop !== false ||
    settings.requestRenderMode !== true ||
    settings.globeShown !== false ||
    settings.clockEpochMs !== 1_791_460_800_000 ||
    settings.antialias !== true ||
    settings.preserveDrawingBuffer !== true
  )
    fail('rendering settings are incomplete or changed');
  cameraPose(settings.camera, 'declared');
  if (
    Math.abs(settings.camera.longitude - -97.7431) > 0.00001 ||
    Math.abs(settings.camera.latitude - 30.2672) > 0.00001 ||
    Math.abs(settings.camera.height - 3500) > 1 ||
    Math.abs(
      Math.atan2(
        Math.sin(settings.camera.heading),
        Math.cos(settings.camera.heading),
      ),
    ) > 0.0001 ||
    Math.abs(settings.camera.pitch + Math.PI / 2) > 0.0001
  )
    fail('declared camera pose changed');

  const cohort = report.cohort;
  count(cohort?.limit, 'cohort limit', { min: 14, max: 14 });
  count(cohort?.peakLiveVolumes, 'peak live volume', { min: 14, max: 14 });
  count(cohort?.initialVolumeCount, 'initial volume', { min: 14, max: 14 });
  count(cohort?.retainedModeToggleBuilds, 'retained toggle build');
  if (cohort.retainedModeToggleBuilds !== 0)
    fail('mode toggles rebuilt retained volumes');
  count(cohort.disableEnableCycles, 'disable/enable cycle', { min: 2, max: 2 });
  count(cohort.disableEnableBuilds, 'disable/enable build');
  if (
    cohort.disableEnableBuilds !== 0 ||
    cohort.disableEnableIdentitiesPreserved !== true ||
    cohort.disableEnableCameraId !== fixture.cameraIds[1]
  )
    fail('disable/enable rebuilt retained volumes');
  if (
    !Array.isArray(cohort.beforeHandoffIds) ||
    cohort.beforeHandoffIds.length !== 14
  )
    fail('initial cohort is incomplete');
  if (
    !Array.isArray(cohort.afterHandoffIds) ||
    cohort.afterHandoffIds.length !== 14
  )
    fail('handoff cohort is incomplete');
  if (
    new Set(cohort.beforeHandoffIds).size !== 14 ||
    new Set(cohort.afterHandoffIds).size !== 14
  )
    fail('cohort contains duplicate camera identities');
  if (
    [...cohort.beforeHandoffIds, ...cohort.afterHandoffIds].some(
      (id) => !fixture.cameraIds.includes(id),
    )
  )
    fail('cohort contains an unknown camera identity');
  if (!cohort.afterHandoffIds.includes(fixture.cameraIds.at(-1)))
    fail('handoff did not retain the final selected camera');
  const evicted = cohort.beforeHandoffIds.filter(
    (id) => !cohort.afterHandoffIds.includes(id),
  );
  if (evicted.length < 1) fail('handoff did not evict an old cohort member');
  if (
    cohort.modeSequence?.join('|') !== CCTV_VIEWSHED_RETENTION_MODES.join('|')
  )
    fail('coverage mode round-trip is invalid');
  if (cohort.preReadyTintFlipObserved !== true)
    fail('pre-ready tint flip was not observed');
  count(cohort.duplicateCameraIdCount, 'duplicate volume identity');
  if (cohort.duplicateCameraIdCount !== 0)
    fail('a camera had duplicate live volume primitives');

  const pose = report.hiddenPoseEdit;
  if (pose?.coverageHidden !== true || pose.calibrationChanged !== true)
    fail('hidden pose edit is incomplete');
  finite(pose.beforeOffsetEastM, 'hidden pose before offset', {
    min: -100,
    max: 100,
  });
  finite(pose.afterOffsetEastM, 'hidden pose after offset', {
    min: -100,
    max: 100,
  });
  if (pose.beforeOffsetEastM === pose.afterOffsetEastM)
    fail('hidden pose edit did not change the camera');
  count(pose.reentryBuildCount, 'hidden pose reentry build', {
    min: 1,
    max: 14,
  });

  const tint = report.activeTint;
  if (tint?.cameraId !== fixture.cameraIds.at(-1))
    fail('active tint camera is invalid');
  rgba(tint.expectedRgba, 'expected tint');
  rgba(tint.observedRgba, 'observed tint');
  sameNumbers(
    tint.expectedRgba,
    expectedFillRgba(tint.cameraId, true, fixture.cameraIds),
    'declared active tint',
  );
  sameNumbers(tint.observedRgba, tint.expectedRgba, 'active tint');
  if (tint.translucent !== true || tint.allowPicking !== false)
    fail('volume rendering/picking contract changed');
  const preReadyTint = report.preReadyTint;
  if (
    preReadyTint?.cameraId !== fixture.cameraIds[1] ||
    preReadyTint.readyAtSwitch !== false
  )
    fail('pre-ready active tint evidence is invalid');
  rgba(preReadyTint.expectedRgba, 'pre-ready expected tint');
  rgba(preReadyTint.observedRgba, 'pre-ready observed tint');
  sameNumbers(
    preReadyTint.expectedRgba,
    expectedFillRgba(preReadyTint.cameraId, true, fixture.cameraIds),
    'declared pre-ready tint',
  );
  sameNumbers(
    preReadyTint.observedRgba,
    preReadyTint.expectedRgba,
    'pre-ready active tint',
  );
  if (preReadyTint.translucent !== true || preReadyTint.allowPicking !== false)
    fail('pre-ready volume rendering/picking contract changed');

  const retained = report.retained;
  const rebuilt = report.rebuildControl;
  const visibility = report.viewshedVisibility;
  pixelSummary(visibility?.viewshedOn, 'visible viewshed');
  pixelSummary(visibility?.viewshedOff, 'wireframe-only');
  count(visibility.changedPixels, 'viewshed visibility difference', {
    min: 1,
    max: visibility.viewshedOn.width * visibility.viewshedOn.height,
  });
  if (
    visibility.viewshedOn.width !== visibility.viewshedOff.width ||
    visibility.viewshedOn.height !== visibility.viewshedOff.height ||
    visibility.viewshedOn.rgbaSha256 === visibility.viewshedOff.rgbaSha256
  )
    fail('viewshed visibility pixels do not show the volume');
  if (rebuilt?.label !== 'full-layer-rebuild-control')
    fail('rebuild control is not honestly labeled');
  pixelSummary(retained?.pixels, 'retained');
  pixelSummary(rebuilt?.pixels, 'rebuild control');
  if (
    retained.pixels.width !== rebuilt.pixels.width ||
    retained.pixels.height !== rebuilt.pixels.height ||
    retained.pixels.width !== settings.drawingBufferWidth ||
    retained.pixels.height !== settings.drawingBufferHeight ||
    retained.pixels.rgbaSha256 !== rebuilt.pixels.rgbaSha256 ||
    rebuilt.pixelComparison?.exactMatch !== true ||
    rebuilt.pixelComparison?.changedPixels !== 0
  )
    fail('retained output differs from the matched rebuild control');
  if (
    retained.cameraId !== rebuilt.cameraId ||
    retained.cameraId !== fixture.cameraIds.at(-1)
  )
    fail('retained and rebuild camera identities differ');
  cameraPose(retained.camera, 'retained');
  cameraPose(rebuilt.camera, 'rebuild control');
  if (JSON.stringify(retained.camera) !== JSON.stringify(rebuilt.camera))
    fail('retained and rebuild camera poses differ');
  if (
    JSON.stringify(retained.settings) !== JSON.stringify(settings) ||
    JSON.stringify(rebuilt.settings) !== JSON.stringify(settings)
  )
    fail('retained and rebuild settings differ from the declared settings');
  count(retained.liveVolumes, 'retained live volume', { min: 14, max: 14 });
  count(rebuilt.buildCount, 'rebuild-control construction', {
    min: 14,
    max: 14,
  });

  const cleanup = report.cleanup;
  if (
    cleanup?.retainedLayerDestroyed !== true ||
    cleanup?.layerDestroyed !== true ||
    cleanup.viewerDestroyed !== true ||
    cleanup.wrappersRestored !== true ||
    cleanup.worldOverlayDestroyed !== true ||
    cleanup.governorUninstalled !== true ||
    cleanup.liveVolumes !== 0
  )
    fail('owner teardown is incomplete');
  count(cleanup.createdVolumes, 'created volume', { min: 28, max: 10_000 });
  count(cleanup.removedVolumes, 'removed volume', {
    min: cleanup.createdVolumes,
    max: cleanup.createdVolumes,
  });
  count(cleanup.destroyedVolumes, 'destroyed volume', {
    min: cleanup.createdVolumes,
    max: cleanup.createdVolumes,
  });
  count(cleanup.postRenderListenersBefore, 'post-render listeners before');
  count(cleanup.postRenderListenersAfter, 'post-render listeners after', {
    min: cleanup.postRenderListenersBefore,
    max: cleanup.postRenderListenersBefore,
  });
  count(
    cleanup.postRenderListenersAfterLayer,
    'listeners after layer teardown',
    {
      min: cleanup.postRenderListenersBefore,
      max: cleanup.postRenderListenersBefore,
    },
  );
  count(
    cleanup.postRenderListenersAfterOwners,
    'listeners after owner teardown',
    {
      max: cleanup.postRenderListenersAfterLayer,
    },
  );
  return report;
}
