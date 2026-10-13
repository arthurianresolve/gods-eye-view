import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as Cesium from 'cesium';
import { cameraHue, viewshedColors } from '../../src/data/cctvViewshed.js';
import {
  CCTV_VIEWSHED_RETENTION_CAMERA_COUNT,
  CCTV_VIEWSHED_RETENTION_FIXTURE_DESCRIPTOR,
  CCTV_VIEWSHED_RETENTION_FIXTURE_ID,
  CCTV_VIEWSHED_RETENTION_FIXTURE_SHA256,
  CCTV_VIEWSHED_RETENTION_LIMIT,
  CCTV_VIEWSHED_RETENTION_MODES,
  validateCctvViewshedRetentionReport,
} from './cctvViewshedRetention.mjs';

const commit = 'a'.repeat(40);
const ids = Array.from(
  { length: CCTV_VIEWSHED_RETENTION_CAMERA_COUNT },
  (_, index) => `qa-viewshed-camera-${String(index).padStart(2, '0')}`,
);
const pose = {
  longitude: -97.7431,
  latitude: 30.2672,
  height: 3500,
  heading: 0,
  pitch: -Math.PI / 2,
};
const settings = {
  coverageMode: 'viewshed',
  showProjection: false,
  autoHop: false,
  requestRenderMode: true,
  globeShown: false,
  clockEpochMs: 1_791_460_800_000,
  drawingBufferWidth: 1200,
  drawingBufferHeight: 800,
  viewportWidth: 1200,
  viewportHeight: 960,
  msaaSamples: 4,
  antialias: true,
  preserveDrawingBuffer: true,
  camera: pose,
};
const pixels = {
  width: 1200,
  height: 800,
  frameBefore: 10,
  frameAfter: 11,
  rgbaSha256: 'c'.repeat(64),
  nonBackgroundPixels: 400,
  distinctRgbSamples: 7,
};

function expectedActiveRgba(cameraId) {
  const hueIndex = [...ids].sort().indexOf(cameraId);
  const colors = viewshedColors(cameraHue(hueIndex));
  return Array.from(
    Cesium.ColorGeometryInstanceAttribute.fromColor(colors.fillActive).value,
  );
}

function validReport() {
  return {
    schema: 'gev-cctv-viewshed-retention/v2',
    status: 'passed',
    phase: 'complete',
    scope: 'rendered CCTV component retention comparison',
    performanceAcceptanceEligible: false,
    pixelFailureEvidence: null,
    environment: { renderer: 'Test renderer' },
    applicationCommit: commit,
    harnessCommit: commit,
    fixture: {
      id: CCTV_VIEWSHED_RETENTION_FIXTURE_ID,
      sha256: CCTV_VIEWSHED_RETENTION_FIXTURE_SHA256,
      descriptor: CCTV_VIEWSHED_RETENTION_FIXTURE_DESCRIPTOR,
      cameraCount: CCTV_VIEWSHED_RETENTION_CAMERA_COUNT,
      cameraIds: ids,
    },
    settings,
    cohort: {
      limit: CCTV_VIEWSHED_RETENTION_LIMIT,
      peakLiveVolumes: 14,
      initialVolumeCount: 14,
      retainedModeToggleBuilds: 0,
      disableEnableCycles: 2,
      disableEnableBuilds: 0,
      disableEnableIdentitiesPreserved: true,
      disableEnableCameraId: ids[1],
      beforeHandoffIds: ids.slice(0, 14),
      afterHandoffIds: [...ids.slice(0, 13), ids[15]],
      modeSequence: [...CCTV_VIEWSHED_RETENTION_MODES],
      preReadyTintFlipObserved: true,
      duplicateCameraIdCount: 0,
    },
    hiddenPoseEdit: {
      coverageHidden: true,
      calibrationChanged: true,
      beforeOffsetEastM: 0,
      afterOffsetEastM: 18,
      reentryBuildCount: 1,
    },
    activeTint: {
      cameraId: ids[15],
      expectedRgba: expectedActiveRgba(ids[15]),
      observedRgba: expectedActiveRgba(ids[15]),
      translucent: true,
      allowPicking: false,
    },
    preReadyTint: {
      cameraId: ids[1],
      readyAtSwitch: false,
      expectedRgba: expectedActiveRgba(ids[1]),
      observedRgba: expectedActiveRgba(ids[1]),
      translucent: true,
      allowPicking: false,
    },
    viewshedVisibility: {
      changedPixels: 240,
      viewshedOn: { ...pixels, rgbaSha256: 'd'.repeat(64) },
      viewshedOff: { ...pixels, rgbaSha256: 'e'.repeat(64) },
    },
    retained: {
      cameraId: ids[15],
      camera: pose,
      settings,
      liveVolumes: 14,
      pixels,
    },
    rebuildControl: {
      label: 'full-layer-rebuild-control',
      cameraId: ids[15],
      camera: pose,
      settings,
      buildCount: 14,
      pixels: { ...pixels },
      pixelComparison: { exactMatch: true, changedPixels: 0 },
    },
    cleanup: {
      layerDestroyed: true,
      retainedLayerDestroyed: true,
      viewerDestroyed: true,
      wrappersRestored: true,
      worldOverlayDestroyed: true,
      governorUninstalled: true,
      liveVolumes: 0,
      createdVolumes: 28,
      removedVolumes: 28,
      destroyedVolumes: 28,
      postRenderListenersBefore: 3,
      postRenderListenersAfter: 3,
      postRenderListenersAfterLayer: 3,
      postRenderListenersAfterOwners: 0,
    },
  };
}

test('accepts the bounded retained-versus-rebuild rendered control', () => {
  const report = validReport();
  assert.equal(
    validateCctvViewshedRetentionReport(report, { expectedCommit: commit }),
    report,
  );
});

test('pinned fixture descriptor digest is derived from its authoritative bytes', () => {
  const digest = createHash('sha256')
    .update(JSON.stringify(CCTV_VIEWSHED_RETENTION_FIXTURE_DESCRIPTOR))
    .digest('hex');
  assert.equal(digest, CCTV_VIEWSHED_RETENTION_FIXTURE_SHA256);
});

test('rejects malformed, stale, black, or mismatched retained output', () => {
  const cases = [
    [(report) => (report.performanceAcceptanceEligible = true), /ineligible/],
    [
      (report) => (report.pixelFailureEvidence = { retainedPngBase64: 'AA==' }),
      /failure-only pixel evidence/,
    ],
    [(report) => (report.fixture.cameraCount = 15), /camera count/],
    [(report) => (report.fixture.sha256 = 'b'.repeat(64)), /pinned descriptor/],
    [
      (report) => (report.fixture.descriptor.frameDataSha256 = 'b'.repeat(64)),
      /pinned descriptor/,
    ],
    [(report) => (report.cohort.peakLiveVolumes = 15), /peak live volume/],
    [
      (report) => (report.cohort.retainedModeToggleBuilds = 1),
      /rebuilt retained/,
    ],
    [
      (report) => (report.cohort.disableEnableBuilds = 1),
      /disable\/enable rebuilt/,
    ],
    [
      (report) => (report.cohort.disableEnableIdentitiesPreserved = false),
      /disable\/enable rebuilt/,
    ],
    [
      (report) => (report.cohort.disableEnableCameraId = ids[2]),
      /disable\/enable rebuilt/,
    ],
    [
      (report) =>
        (report.cohort.afterHandoffIds = report.cohort.beforeHandoffIds),
      /handoff/,
    ],
    [(report) => (report.cohort.preReadyTintFlipObserved = false), /pre-ready/],
    [
      (report) => (report.hiddenPoseEdit.afterOffsetEastM = 0),
      /did not change/,
    ],
    [(report) => (report.activeTint.observedRgba[3] = 0), /active tint/],
    [(report) => (report.activeTint.allowPicking = true), /picking/],
    [
      (report) => (report.preReadyTint.observedRgba[0] = 0),
      /pre-ready active tint/,
    ],
    [
      (report) => (report.viewshedVisibility.changedPixels = 0),
      /difference count/,
    ],
    [
      (report) => (report.cohort.duplicateCameraIdCount = 1),
      /duplicate live volume/,
    ],
    [(report) => (report.cleanup.retainedLayerDestroyed = false), /teardown/],
    [(report) => (report.retained.pixels.frameAfter = 10), /frame after/],
    [
      (report) => (report.retained.pixels.nonBackgroundPixels = 0),
      /non-background/,
    ],
    [
      (report) => (report.rebuildControl.label = 'unlabeled'),
      /honestly labeled/,
    ],
    [
      (report) => (report.rebuildControl.pixelComparison.changedPixels = 1),
      /differs/,
    ],
    [(report) => (report.cleanup.liveVolumes = 1), /teardown/],
    [(report) => (report.cleanup.removedVolumes = 27), /removed volume/],
    [
      (report) => (report.settings.drawingBufferWidth = undefined),
      /drawing buffer/,
    ],
    [(report) => (report.settings.drawingBufferWidth = 1199), /drawing buffer/],
    [(report) => (report.settings.drawingBufferHeight = 801), /drawing buffer/],
    [(report) => (report.settings.viewportHeight = 959), /viewport height/],
    [(report) => (report.settings.msaaSamples = 0), /MSAA sample/],
    [(report) => (report.settings.msaaSamples = 8), /MSAA sample/],
    [(report) => (report.settings.coverageMode = 'on'), /rendering settings/],
    [(report) => (report.settings.showProjection = true), /rendering settings/],
    [(report) => (report.settings.autoHop = true), /rendering settings/],
    [(report) => (report.settings.camera.heading = 0.1), /camera pose changed/],
    [(report) => (report.settings.camera.pitch = 0), /camera pose changed/],
    [
      (report) => (report.cleanup.postRenderListenersAfterLayer = 2),
      /listeners after layer teardown/,
    ],
    [
      (report) => (report.cleanup.postRenderListenersAfterOwners = 4),
      /listeners after owner teardown/,
    ],
  ];
  for (const [mutate, expected] of cases) {
    const report = structuredClone(validReport());
    mutate(report);
    assert.throws(() => validateCctvViewshedRetentionReport(report), expected);
  }
});
