import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareCctvCalibrationPair,
  summarizeCctvRgbaDifference,
  validateCctvCalibrationDemandReport,
} from './cctvCalibrationDemand.mjs';

const commit = 'a'.repeat(40);
const digest = (character) => character.repeat(64);
const fixtureId = 'cctv-calibration-native-drag/v1';
const cameraId = 'qa-cctv-calibration-camera-001';

test('exact RGBA diagnostics locate mismatches without visual tolerance', () => {
  const left = new Uint8Array(3 * 2 * 4);
  const right = left.slice();
  right[4] = 1;
  right[23] = 2;
  assert.deepEqual(summarizeCctvRgbaDifference(left, left, 3, 2), {
    differenceCount: 0,
    bounds: null,
  });
  assert.deepEqual(summarizeCctvRgbaDifference(left, right, 3, 2), {
    differenceCount: 2,
    bounds: { left: 1, top: 0, right: 2, bottom: 1, width: 2, height: 2 },
  });
});

test('RGBA diagnostics reject malformed and oversized evidence', () => {
  assert.throws(() => summarizeCctvRgbaDifference([0], [0], 1, 1));
  assert.throws(() => summarizeCctvRgbaDifference([], [], 1200, 801));
});

const viewport = {
  width: 960,
  height: 640,
  devicePixelRatio: 1,
  cssWidth: 960,
  cssHeight: 520,
  viewportWidth: 1200,
  viewportHeight: 960,
};
const renderingSettings = (mode) => ({
  initialRequestRenderMode: true,
  requestRenderModeDuringIdle: mode === 'candidate',
  drawingBufferWidth: viewport.width,
  drawingBufferHeight: viewport.height,
  cssWidth: viewport.cssWidth,
  cssHeight: viewport.cssHeight,
  viewportWidth: viewport.viewportWidth,
  viewportHeight: viewport.viewportHeight,
  devicePixelRatio: viewport.devicePixelRatio,
  msaaSamples: 4,
  antialias: true,
  preserveDrawingBuffer: false,
  contextAttributes: {
    alpha: true,
    antialias: true,
    depth: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  },
});
const calibration = (offsetEastM) => ({
  offsetEastM,
  offsetNorthM: 0,
  headingDeg: 0,
  pitchDeg: -15,
  fovDeg: 70,
  rangeScale: 1,
  heightM: 22,
});

function trial(mode, pair, globalIndex) {
  const before = calibration(0);
  const after = calibration(8);
  const settledLayout = {
    drawingBufferWidth: viewport.width,
    drawingBufferHeight: viewport.height,
    cssWidth: viewport.cssWidth,
    cssHeight: viewport.cssHeight,
    cssLeft: 0,
    cssTop: 0,
    viewportWidth: viewport.viewportWidth,
    viewportHeight: viewport.viewportHeight,
    devicePixelRatio: viewport.devicePixelRatio,
  };
  return {
    schema: 'gev-cctv-calibration-trial/v1',
    status: 'passed',
    mode,
    pair,
    fixtureId,
    fixtureSha256: digest('f'),
    applicationCommit: commit,
    harnessCommit: commit,
    startedAt: new Date(Date.UTC(2026, 9, 8, 12, globalIndex)).toISOString(),
    phase: `pair-${pair}-${mode}-after-drag-render`,
    viewport: { ...viewport },
    layoutEvidence: {
      settled: settledLayout,
      cameraCapture: {
        before: { ...settledLayout },
        after: { ...settledLayout },
        stable: true,
      },
      beforePixelsCapture: {
        before: { ...settledLayout },
        after: { ...settledLayout },
        stable: true,
      },
      afterPixelsCapture: {
        before: { ...settledLayout },
        after: { ...settledLayout },
        stable: true,
      },
    },
    environment: {
      renderer: 'Synthetic deterministic test renderer',
      maskedRenderer: 'WebKit WebGL',
      rendererIdentity: 'unmasked-extension',
      userAgent: 'Browser fixture test',
    },
    camera: {
      selectedCameraId: cameraId,
      position: [1, 2, 3],
      direction: [0, 0, -1],
      up: [0, 1, 0],
      geometrySha256: digest('3'),
    },
    initialCalibration: before,
    renderingSettings: renderingSettings(mode),
    idle: {
      requestedDurationMs: 10_000,
      durationMs: 10_000,
      completedFrames: mode === 'candidate' ? 1 : 300,
      renderMode: mode === 'candidate',
      forcedCaptureFramesIncluded: false,
      conditions: {
        before: {
          visibilityState: 'visible',
          focused: true,
          viewportWidth: viewport.viewportWidth,
          viewportHeight: viewport.viewportHeight,
          devicePixelRatio: viewport.devicePixelRatio,
          canvasLayout: { ...settledLayout },
        },
        after: {
          visibilityState: 'visible',
          focused: true,
          viewportWidth: viewport.viewportWidth,
          viewportHeight: viewport.viewportHeight,
          devicePixelRatio: viewport.devicePixelRatio,
          canvasLayout: { ...settledLayout },
        },
        events: [],
        eventOverflow: false,
        foregroundUninterrupted: true,
        canvasLayoutUnchanged: true,
        durationMs: 10_000,
        completedPhase: 'observation',
      },
    },
    drag: {
      instructionId: `calibration-${pair}-${mode}-${globalIndex}`,
      instructionDelivered: true,
      kind: 'drag',
      steps: 6,
      from: { x: 140, y: 160 },
      to: { x: 158, y: 160 },
      trustedPointerDown: true,
      trustedPointerMoveCount: 6,
      trustedPointerUp: true,
      dragInputsDisabledObserved: true,
      dragInputsRestoredAfterRelease: true,
      acceptedCalibrationChanged: true,
      committedAfterRelease: true,
      selectedCameraIdAfterRelease: cameraId,
      pickIdentity: {
        trusted: true,
        entityId: 'cctv-gizmo-move-east',
        kind: 'move-east',
        cameraId,
        x: 140,
        y: 160,
        targetDistancePx: 0,
      },
      pickEvidence: {
        returnedObject: true,
        entityId: 'cctv-gizmo-move-east',
        client: { x: 140, y: 160 },
        canvasRect: {
          left: 0,
          top: 0,
          width: viewport.cssWidth,
          height: viewport.cssHeight,
        },
        cssLocal: { x: 140, y: 160 },
        drawingBuffer: {
          width: viewport.width,
          height: viewport.height,
          x: 140,
          y: (160 * viewport.height) / viewport.cssHeight,
        },
      },
      canvasLayoutAtPointerDown: { ...settledLayout },
      canvasLayoutObservations: {
        beforeInstruction: { ...settledLayout },
        afterInstruction: { ...settledLayout },
        afterRelease: { ...settledLayout },
        afterCapture: { ...settledLayout },
      },
      conditions: {
        before: {
          visibilityState: 'visible',
          focused: true,
          viewportWidth: viewport.viewportWidth,
          viewportHeight: viewport.viewportHeight,
          devicePixelRatio: viewport.devicePixelRatio,
          canvasLayout: { ...settledLayout },
        },
        after: {
          visibilityState: 'visible',
          focused: true,
          viewportWidth: viewport.viewportWidth,
          viewportHeight: viewport.viewportHeight,
          devicePixelRatio: viewport.devicePixelRatio,
          canvasLayout: { ...settledLayout },
        },
        events: [],
        eventOverflow: false,
        foregroundUninterrupted: true,
        canvasLayoutUnchanged: true,
        durationMs: 500,
        completedPhase: 'after-frame-capture',
      },
      calibrationBefore: before,
      calibrationAfter: after,
      changedFields: ['offsetEastM'],
      geometrySha256After: digest('4'),
    },
    beforePixels: {
      sha256: digest('1'),
      width: viewport.width,
      height: viewport.height,
      nonBackgroundPixels: 1800,
      captureState: {
        dataSourceDisplayReady: true,
        currentVisualizerUpdateReady: true,
      },
    },
    afterPixels: {
      sha256: digest('2'),
      width: viewport.width,
      height: viewport.height,
      nonBackgroundPixels: 1820,
      captureState: {
        dataSourceDisplayReady: true,
        currentVisualizerUpdateReady: true,
      },
    },
    cleanup: {
      layerDisabled: true,
      layerDestroyed: true,
      worldOverlayDestroyed: true,
      governorUninstalled: true,
      viewerDestroyed: true,
      ownedEntitiesBeforeDestroy: 5,
      ownedEntitiesAfterLayerDestroy: 0,
      governorHoldsAfterLayerDestroy: 0,
      error: null,
    },
  };
}

function validReport() {
  const pairs = Array.from({ length: 5 }, (_, pair) => {
    const order =
      pair % 2
        ? ['candidate', 'legacy-control']
        : ['legacy-control', 'candidate'];
    const runs = order.map((mode, orderIndex) =>
      trial(mode, pair, pair * 2 + orderIndex),
    );
    const row = { pair, order, runs, comparison: null };
    row.comparison = compareCctvCalibrationPair(row);
    return row;
  });
  return {
    schema: 'gev-cctv-calibration-render-demand/v1',
    fixture: {
      id: fixtureId,
      sha256: digest('f'),
      cameraId,
      epochMs: Date.UTC(2026, 9, 8, 12),
      idleRequestedMs: 10_000,
    },
    applicationCommit: commit,
    harnessCommit: commit,
    scope:
      'isolated production CCTV layer; native calibration input and render-demand comparison',
    status: 'passed',
    phase: 'complete',
    pairs,
    cleanup: {
      trials: 10,
      allTrialsReleased: true,
      viewerDestroyedCount: 10,
      governorUninstalledCount: 10,
    },
    environment: {
      renderer: 'Synthetic deterministic test renderer',
      maskedRenderer: 'WebKit WebGL',
      rendererIdentity: 'unmasked-extension',
      userAgent: 'Browser fixture test',
      desktopForegroundVerification: 'unavailable',
    },
    viewport: { ...viewport },
    startedAt: new Date(Date.UTC(2026, 9, 8, 12)).toISOString(),
    finishedAt: new Date(Date.UTC(2026, 9, 8, 12, 20)).toISOString(),
  };
}

test('accepts five alternating, fully evidenced native calibration pairs', () => {
  const report = validReport();
  assert.deepEqual(
    validateCctvCalibrationDemandReport(report, { expectedCommit: commit }),
    {
      status: 'passed',
      pairCount: 5,
      legacyIdleFrames: 1500,
      candidateIdleFrames: 5,
    },
  );
});

test('rejects shortened idle observation, missing frames, and capture-contaminated interval', () => {
  for (const mutate of [
    (run) => {
      run.idle.durationMs = 9_500;
    },
    (run) => {
      delete run.idle.completedFrames;
    },
    (run) => {
      run.idle.forcedCaptureFramesIncluded = true;
    },
  ]) {
    const report = validReport();
    mutate(report.pairs[0].runs[0]);
    assert.throws(() =>
      validateCctvCalibrationDemandReport(report, { expectedCommit: commit }),
    );
  }
});

test('rejects missing or changing post-setup canvas layout evidence', () => {
  for (const mutate of [
    (run) => {
      delete run.layoutEvidence.cameraCapture;
    },
    (run) => {
      run.layoutEvidence.afterPixelsCapture.stable = false;
    },
    (run) => {
      run.layoutEvidence.beforePixelsCapture.after.cssHeight -= 1;
    },
    (run) => {
      run.layoutEvidence.settled.drawingBufferHeight -= 1;
    },
  ]) {
    const report = validReport();
    mutate(report.pairs[0].runs[0]);
    assert.throws(() =>
      validateCctvCalibrationDemandReport(report, { expectedCommit: commit }),
    );
  }
});

test('rejects pick evidence from a mismatched canvas coordinate mapping', () => {
  const report = validReport();
  report.pairs[0].runs[0].drag.pickEvidence.drawingBuffer.y += 3;
  assert.throws(() =>
    validateCctvCalibrationDemandReport(report, { expectedCommit: commit }),
  );
});

test('rejects instruction-induced canvas changes even with a stable window viewport', () => {
  for (const mutate of [
    (run) => {
      run.drag.canvasLayoutObservations.afterInstruction.cssWidth = 1278;
    },
    (run) => {
      run.drag.canvasLayoutObservations.afterRelease.drawingBufferWidth += 1;
    },
    (run) => {
      run.drag.canvasLayoutAtPointerDown.cssWidth += 1;
    },
    (run) => {
      delete run.drag.canvasLayoutObservations;
    },
    (run) => {
      run.idle.conditions.canvasLayoutUnchanged = false;
    },
    (run) => {
      run.drag.conditions.after.canvasLayout.cssLeft += 2;
    },
  ]) {
    const report = validReport();
    mutate(report.pairs[0].runs[0]);
    assert.throws(() =>
      validateCctvCalibrationDemandReport(report, { expectedCommit: commit }),
    );
  }
});

test('rejects missing pointer, pixel, foreground, or cleanup evidence', () => {
  for (const mutate of [
    (run) => {
      delete run.drag.trustedPointerMoveCount;
    },
    (run) => {
      delete run.beforePixels.nonBackgroundPixels;
    },
    (run) => {
      run.afterPixels.captureState.currentVisualizerUpdateReady = false;
      run.visualizerFollowup = { readyObserved: true };
    },
    (run) => {
      delete run.beforePixels.captureState.dataSourceDisplayReady;
    },
    (run) => {
      run.idle.conditions.before.focused = false;
    },
    (run) => {
      run.idle.conditions.after.visibilityState = 'hidden';
    },
    (run) => {
      run.idle.conditions.events.push({ type: 'blur' });
    },
    (run) => {
      run.idle.conditions.before.viewportWidth -= 1;
    },
    (run) => {
      run.drag.conditions.after.focused = false;
    },
    (run) => {
      run.cleanup.ownedEntitiesAfterLayerDestroy = 1;
    },
  ]) {
    const report = validReport();
    mutate(report.pairs[0].runs[0]);
    assert.throws(() =>
      validateCctvCalibrationDemandReport(report, { expectedCommit: commit }),
    );
  }
});

test('rejects settings, source, camera selection, phase order, and pixel identity drift', () => {
  for (const mutate of [
    (report) => {
      report.pairs[0].runs[1].renderingSettings.msaaSamples = 8;
    },
    (report) => {
      report.pairs[1].runs[0].fixtureSha256 = digest('e');
    },
    (report) => {
      report.pairs[2].runs[1].drag.selectedCameraIdAfterRelease =
        'other-camera';
    },
    (report) => {
      report.pairs[3].runs.reverse();
    },
    (report) => {
      report.pairs[4].runs[1].afterPixels.sha256 = digest('3');
    },
    (report) => {
      report.pairs[2].runs[1].camera.geometrySha256 = digest('9');
    },
    (report) => {
      report.pairs[2].runs[1].environment.userAgent = 'other browser';
    },
    (report) => {
      report.pairs[2].runs[1].renderingSettings.contextAttributes.antialias = false;
    },
    (report) => {
      report.pairs[2].runs[1].drag.pickIdentity.entityId =
        'cctv-gizmo-ring-heading';
    },
    (report) => {
      report.pairs[2].runs[1].drag.from.x += 3;
    },
  ]) {
    const report = validReport();
    mutate(report);
    assert.throws(() =>
      validateCctvCalibrationDemandReport(report, { expectedCommit: commit }),
    );
  }
});

test('recomputes changed calibration fields and requires visible drag pixels', () => {
  const report = validReport();
  const run = report.pairs[0].runs[0];
  run.drag.changedFields = [];
  assert.throws(() =>
    validateCctvCalibrationDemandReport(report, { expectedCommit: commit }),
  );

  const unchangedPixels = validReport();
  unchangedPixels.pairs[0].runs[0].afterPixels.sha256 =
    unchangedPixels.pairs[0].runs[0].beforePixels.sha256;
  assert.throws(() =>
    validateCctvCalibrationDemandReport(unchangedPixels, {
      expectedCommit: commit,
    }),
  );

  const alteredReduction = validReport();
  alteredReduction.pairs[0].comparison.idleFrameReduction = 0;
  assert.throws(() =>
    validateCctvCalibrationDemandReport(alteredReduction, {
      expectedCommit: commit,
    }),
  );
});

test('rejects failed reports, unbound commits, duplicate instructions, and incomplete cleanup', () => {
  const wrongCommit = validReport();
  assert.throws(() =>
    validateCctvCalibrationDemandReport(wrongCommit, {
      expectedCommit: 'b'.repeat(40),
    }),
  );

  const failure = validReport();
  failure.status = 'failed';
  failure.error = 'Native drag did not settle';
  failure.failedPhase = 'pair-1-native-drag';
  assert.throws(() =>
    validateCctvCalibrationDemandReport(failure, { expectedCommit: commit }),
  );

  const duplicate = validReport();
  duplicate.pairs[1].runs[0].drag.instructionId =
    duplicate.pairs[0].runs[0].drag.instructionId;
  assert.throws(() =>
    validateCctvCalibrationDemandReport(duplicate, { expectedCommit: commit }),
  );

  const cleanup = validReport();
  cleanup.cleanup.viewerDestroyedCount = 9;
  assert.throws(() =>
    validateCctvCalibrationDemandReport(cleanup, { expectedCommit: commit }),
  );
});
