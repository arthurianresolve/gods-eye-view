const SHA256 = /^[a-f0-9]{64}$/i;
const SHA1 = /^[a-f0-9]{40}$/i;
const PAIR_COUNT = 5;
const RUN_COUNT = PAIR_COUNT * 2;
const IDLE_REQUESTED_MS = 10_000;
const IDLE_CLOCK_TOLERANCE_MS = 1;
const IDLE_MAX_MS = 11_500;
export const CCTV_RGBA_DIFF_PIXEL_LIMIT = 960_000;
const CALIBRATION_FIELDS = [
  'offsetEastM',
  'offsetNorthM',
  'headingDeg',
  'pitchDeg',
  'fovDeg',
  'rangeScale',
  'heightM',
];

function digest(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new Error(`CCTV calibration ${label} digest is missing.`);
}

function integer(
  value,
  label,
  { min = 0, max = Number.MAX_SAFE_INTEGER } = {},
) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`CCTV calibration ${label} count is invalid.`);
}

function finite(value, label) {
  if (!Number.isFinite(value))
    throw new Error(`CCTV calibration ${label} is invalid.`);
}

function exactJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Exact pixel-level comparison used only for bounded failure diagnostics. */
export function summarizeCctvRgbaDifference(left, right, width, height) {
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    width * height > CCTV_RGBA_DIFF_PIXEL_LIMIT ||
    !left ||
    !right ||
    left.length !== width * height * 4 ||
    right.length !== width * height * 4
  )
    throw new Error('CCTV RGBA evidence has an invalid bounded shape.');
  let differenceCount = 0;
  let leftEdge = width;
  let topEdge = height;
  let rightEdge = -1;
  let bottomEdge = -1;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    if (
      left[offset] === right[offset] &&
      left[offset + 1] === right[offset + 1] &&
      left[offset + 2] === right[offset + 2] &&
      left[offset + 3] === right[offset + 3]
    )
      continue;
    differenceCount++;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    leftEdge = Math.min(leftEdge, x);
    topEdge = Math.min(topEdge, y);
    rightEdge = Math.max(rightEdge, x);
    bottomEdge = Math.max(bottomEdge, y);
  }
  return {
    differenceCount,
    bounds:
      differenceCount > 0
        ? {
            left: leftEdge,
            top: topEdge,
            right: rightEdge,
            bottom: bottomEdge,
            width: rightEdge - leftEdge + 1,
            height: bottomEdge - topEdge + 1,
          }
        : null,
  };
}

function equivalentMeasuredSettings(run) {
  return {
    ...run.renderingSettings,
    requestRenderModeDuringIdle: null,
  };
}

function assertCalibration(value, label) {
  if (!value || typeof value !== 'object')
    throw new Error(`CCTV calibration ${label} values are missing.`);
  for (const field of CALIBRATION_FIELDS)
    finite(value[field], `${label}.${field}`);
}

function changedCalibrationFields(before, after) {
  assertCalibration(before, 'before');
  assertCalibration(after, 'after');
  return CALIBRATION_FIELDS.filter((field) => before[field] !== after[field]);
}

function assertViewport(value, label) {
  if (!value || typeof value !== 'object')
    throw new Error(`CCTV calibration ${label} viewport is missing.`);
  for (const key of ['width', 'height']) {
    finite(value[key], `${label}.${key}`);
    if (value[key] <= 0)
      throw new Error(`CCTV calibration ${label}.${key} is invalid.`);
  }
  finite(value.devicePixelRatio, `${label}.devicePixelRatio`);
  if (value.devicePixelRatio <= 0)
    throw new Error(`CCTV calibration ${label} device pixel ratio is invalid.`);
}

const LAYOUT_FIELDS = [
  'drawingBufferWidth',
  'drawingBufferHeight',
  'cssWidth',
  'cssHeight',
  'cssLeft',
  'cssTop',
  'viewportWidth',
  'viewportHeight',
  'devicePixelRatio',
];

function assertStableLayoutEvidence(run) {
  const evidence = run.layoutEvidence;
  const settled = evidence?.settled;
  if (!settled || typeof settled !== 'object')
    throw new Error('CCTV settled canvas layout evidence is missing.');
  for (const field of LAYOUT_FIELDS) finite(settled[field], `layout.${field}`);
  if (
    settled.drawingBufferWidth !== run.viewport.width ||
    settled.drawingBufferHeight !== run.viewport.height ||
    settled.cssWidth !== run.viewport.cssWidth ||
    settled.cssHeight !== run.viewport.cssHeight ||
    settled.viewportWidth !== run.viewport.viewportWidth ||
    settled.viewportHeight !== run.viewport.viewportHeight ||
    settled.devicePixelRatio !== run.viewport.devicePixelRatio
  )
    throw new Error('CCTV settled layout differs from the recorded viewport.');
  for (const phase of [
    'cameraCapture',
    'beforePixelsCapture',
    'afterPixelsCapture',
  ]) {
    const capture = evidence[phase];
    if (
      !capture ||
      capture.stable !== true ||
      !capture.before ||
      !capture.after ||
      !exactJson(capture.before, settled) ||
      !exactJson(capture.after, settled)
    )
      throw new Error(`CCTV ${phase} layout was not stable after setup.`);
  }
}

function assertCleanup(cleanup, label) {
  if (
    cleanup?.layerDisabled !== true ||
    cleanup?.layerDestroyed !== true ||
    cleanup?.worldOverlayDestroyed !== true ||
    cleanup?.governorUninstalled !== true ||
    cleanup?.viewerDestroyed !== true ||
    cleanup?.error ||
    !Number.isSafeInteger(cleanup.ownedEntitiesBeforeDestroy) ||
    cleanup.ownedEntitiesBeforeDestroy < 1 ||
    cleanup.ownedEntitiesAfterLayerDestroy !== 0 ||
    cleanup.governorHoldsAfterLayerDestroy !== 0
  )
    throw new Error(`CCTV calibration ${label} cleanup is incomplete.`);
}

function assertRunEnvironment(run, report) {
  assertViewport(run.viewport, 'trial');
  assertStableLayoutEvidence(run);
  if (
    run.viewport.width !== report.viewport.width ||
    run.viewport.height !== report.viewport.height ||
    run.viewport.devicePixelRatio !== report.viewport.devicePixelRatio ||
    run.viewport.cssWidth !== report.viewport.cssWidth ||
    run.viewport.cssHeight !== report.viewport.cssHeight ||
    run.viewport.viewportWidth !== report.viewport.viewportWidth ||
    run.viewport.viewportHeight !== report.viewport.viewportHeight ||
    run.environment?.renderer !== report.environment.renderer ||
    !run.environment.renderer.trim() ||
    run.environment.userAgent !== report.environment.userAgent ||
    run.environment.maskedRenderer !== report.environment.maskedRenderer ||
    typeof run.environment.maskedRenderer !== 'string' ||
    run.environment.rendererIdentity !== report.environment.rendererIdentity
  )
    throw new Error(
      'CCTV calibration trial environment differs from its report.',
    );

  const settings = run.renderingSettings;
  if (
    !settings ||
    settings.initialRequestRenderMode !== true ||
    settings.requestRenderModeDuringIdle !== (run.mode === 'candidate') ||
    settings.drawingBufferWidth !== run.viewport.width ||
    settings.drawingBufferHeight !== run.viewport.height ||
    settings.devicePixelRatio !== run.viewport.devicePixelRatio ||
    settings.viewportWidth !== run.viewport.viewportWidth ||
    settings.viewportHeight !== run.viewport.viewportHeight ||
    !Number.isSafeInteger(settings.msaaSamples) ||
    settings.msaaSamples < 0 ||
    !settings.contextAttributes ||
    typeof settings.contextAttributes.antialias !== 'boolean'
  )
    throw new Error('CCTV calibration rendering settings are incomplete.');
  finite(settings.cssWidth, 'CSS width');
  finite(settings.cssHeight, 'CSS height');
  if (settings.cssWidth <= 0 || settings.cssHeight <= 0)
    throw new Error('CCTV calibration CSS viewport is invalid.');
  if (
    settings.cssWidth !== run.viewport.cssWidth ||
    settings.cssHeight !== run.viewport.cssHeight
  )
    throw new Error(
      'CCTV calibration CSS surface changed between observations.',
    );
  if (run.camera?.selectedCameraId !== report.fixture.cameraId)
    throw new Error('CCTV calibration selected camera identity differs.');
  digest(run.camera.geometrySha256, 'gizmo geometry');
  if (!Array.isArray(run.camera.position) || run.camera.position.length !== 3)
    throw new Error('CCTV calibration camera position is missing.');
  for (const [index, coordinate] of run.camera.position.entries())
    finite(coordinate, `camera.position[${index}]`);
  if (!Array.isArray(run.camera.direction) || run.camera.direction.length !== 3)
    throw new Error('CCTV calibration camera direction is missing.');
  for (const [index, coordinate] of run.camera.direction.entries())
    finite(coordinate, `camera.direction[${index}]`);
  if (!Array.isArray(run.camera.up) || run.camera.up.length !== 3)
    throw new Error('CCTV calibration camera up vector is missing.');
  for (const [index, coordinate] of run.camera.up.entries())
    finite(coordinate, `camera.up[${index}]`);
  assertCalibration(run.initialCalibration, 'initial');
  if (
    typeof run.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(run.startedAt))
  )
    throw new Error('CCTV calibration trial timestamp is missing.');
}

function assertForegroundConditions(
  conditions,
  viewport,
  {
    completedPhase = 'observation',
    minimumDurationMs = 0,
    expectedLayout = null,
  } = {},
) {
  if (
    !conditions ||
    conditions.foregroundUninterrupted !== true ||
    conditions.before?.visibilityState !== 'visible' ||
    conditions.after?.visibilityState !== 'visible' ||
    conditions.before?.focused !== true ||
    conditions.after?.focused !== true ||
    conditions.canvasLayoutUnchanged !== true ||
    conditions.completedPhase !== completedPhase ||
    !Number.isFinite(conditions.durationMs) ||
    conditions.durationMs < minimumDurationMs ||
    conditions.eventOverflow !== false ||
    !Array.isArray(conditions.events) ||
    conditions.events.length !== 0
  )
    throw new Error(
      'CCTV idle foreground/visibility was interrupted or unavailable.',
    );
  for (const point of [conditions.before, conditions.after]) {
    if (
      point.viewportWidth !== viewport.width ||
      point.viewportHeight !== viewport.height ||
      point.devicePixelRatio !== viewport.devicePixelRatio
    )
      throw new Error('CCTV idle viewport changed during observation.');
    if (expectedLayout && !exactJson(point.canvasLayout, expectedLayout))
      throw new Error('CCTV canvas layout changed during observation.');
  }
}

function assertRun(run, expectedCommit, report) {
  if (
    !run ||
    !['legacy-control', 'candidate'].includes(run.mode) ||
    run.status !== 'passed' ||
    run.error ||
    run.failedPhase ||
    !Number.isSafeInteger(run.pair) ||
    run.pair < 0 ||
    run.fixtureId !== report.fixture.id ||
    run.fixtureSha256 !== report.fixture.sha256 ||
    run.applicationCommit !== expectedCommit ||
    run.harnessCommit !== expectedCommit
  )
    throw new Error(
      'CCTV calibration trial did not complete with matching identity.',
    );
  assertRunEnvironment(run, report);

  const idle = run.idle;
  if (
    !idle ||
    idle.requestedDurationMs !== IDLE_REQUESTED_MS ||
    idle.durationMs < IDLE_REQUESTED_MS - IDLE_CLOCK_TOLERANCE_MS ||
    idle.durationMs > IDLE_MAX_MS ||
    !Number.isFinite(idle.durationMs) ||
    idle.forcedCaptureFramesIncluded !== false
  )
    throw new Error(
      'CCTV calibration idle window is shorter than ten seconds or invalid.',
    );
  integer(idle.completedFrames, 'idle frame');
  if (run.mode === 'candidate' && idle.completedFrames > 2)
    throw new Error('CCTV candidate rendered too many idle frames.');
  if (run.mode === 'legacy-control' && idle.completedFrames < 20)
    throw new Error('CCTV legacy control did not render continuously.');
  if (idle.renderMode !== (run.mode === 'candidate'))
    throw new Error('CCTV idle render mode does not match the trial.');
  assertForegroundConditions(
    idle.conditions,
    {
      width: run.renderingSettings.viewportWidth,
      height: run.renderingSettings.viewportHeight,
      devicePixelRatio: run.viewport.devicePixelRatio,
    },
    { expectedLayout: run.layoutEvidence.settled },
  );

  const drag = run.drag;
  if (
    !drag ||
    typeof drag.instructionId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(drag.instructionId) ||
    drag.instructionDelivered !== true ||
    drag.kind !== 'drag' ||
    drag.steps < 1 ||
    drag.steps > 60 ||
    !Number.isSafeInteger(drag.steps) ||
    drag.trustedPointerDown !== true ||
    !Number.isSafeInteger(drag.trustedPointerMoveCount) ||
    drag.trustedPointerMoveCount < 1 ||
    drag.trustedPointerUp !== true ||
    drag.dragInputsDisabledObserved !== true ||
    drag.dragInputsRestoredAfterRelease !== true ||
    drag.acceptedCalibrationChanged !== true ||
    drag.committedAfterRelease !== true ||
    drag.selectedCameraIdAfterRelease !== report.fixture.cameraId ||
    drag.pickIdentity?.trusted !== true ||
    drag.pickIdentity?.entityId !== 'cctv-gizmo-move-east' ||
    drag.pickIdentity?.kind !== 'move-east' ||
    drag.pickIdentity?.cameraId !== report.fixture.cameraId ||
    drag.pickEvidence?.returnedObject !== true ||
    drag.pickEvidence?.entityId !== 'cctv-gizmo-move-east' ||
    drag.pickEvidence?.drawingBuffer?.width !== run.viewport.width ||
    drag.pickEvidence?.drawingBuffer?.height !== run.viewport.height ||
    !exactJson(drag.canvasLayoutAtPointerDown, run.layoutEvidence.settled) ||
    !drag.pickEvidence?.canvasRect ||
    !drag.pickEvidence?.cssLocal ||
    !drag.pickEvidence?.drawingBuffer ||
    !Number.isFinite(drag.pickIdentity?.targetDistancePx) ||
    drag.pickIdentity.targetDistancePx > 2 ||
    !Array.isArray(drag.changedFields)
  )
    throw new Error('CCTV native calibration drag was not accepted.');
  finite(drag.pickIdentity.x, 'picked pointer x');
  finite(drag.pickIdentity.y, 'picked pointer y');
  for (const axis of ['x', 'y']) {
    finite(drag.pickEvidence.client?.[axis], `pick.client.${axis}`);
    finite(
      drag.pickEvidence.canvasRect?.[axis === 'x' ? 'left' : 'top'],
      `pick.canvasRect.${axis}`,
    );
    finite(
      drag.pickEvidence.canvasRect?.[axis === 'x' ? 'width' : 'height'],
      `pick.canvasRect.${axis}Size`,
    );
    finite(drag.pickEvidence.cssLocal?.[axis], `pick.cssLocal.${axis}`);
    finite(
      drag.pickEvidence.drawingBuffer?.[axis],
      `pick.drawingBuffer.${axis}`,
    );
    if (
      drag.pickEvidence.client[axis] !== drag.pickIdentity[axis] ||
      Math.abs(
        drag.pickEvidence.cssLocal[axis] -
          (drag.pickEvidence.client[axis] -
            drag.pickEvidence.canvasRect[axis === 'x' ? 'left' : 'top']),
      ) > 0.01
    )
      throw new Error('CCTV scene-pick coordinate evidence is inconsistent.');
  }
  const pickRect = drag.pickEvidence.canvasRect;
  if (
    Math.abs(pickRect.left - run.layoutEvidence.settled.cssLeft) > 0.01 ||
    Math.abs(pickRect.top - run.layoutEvidence.settled.cssTop) > 0.01 ||
    Math.abs(pickRect.width - run.layoutEvidence.settled.cssWidth) > 0.01 ||
    Math.abs(pickRect.height - run.layoutEvidence.settled.cssHeight) > 0.01
  )
    throw new Error('CCTV pick was sampled against a different canvas layout.');
  const layoutObservations = drag.canvasLayoutObservations;
  if (
    !layoutObservations ||
    !exactJson(
      layoutObservations.beforeInstruction,
      run.layoutEvidence.settled,
    ) ||
    !exactJson(
      layoutObservations.afterInstruction,
      run.layoutEvidence.settled,
    ) ||
    !exactJson(layoutObservations.afterRelease, run.layoutEvidence.settled) ||
    !exactJson(layoutObservations.afterCapture, run.layoutEvidence.settled)
  )
    throw new Error('CCTV native drag changed the settled canvas layout.');
  for (const [axis, size, rectSize] of [
    ['x', run.viewport.width, pickRect.width],
    ['y', run.viewport.height, pickRect.height],
  ]) {
    const expectedBufferCoordinate =
      (drag.pickEvidence.cssLocal[axis] * size) / rectSize;
    if (
      Math.abs(
        drag.pickEvidence.drawingBuffer[axis] - expectedBufferCoordinate,
      ) > 0.02
    )
      throw new Error('CCTV pick drawing-buffer mapping is inconsistent.');
  }
  for (const key of ['from', 'to']) {
    finite(drag[key]?.x, `drag.${key}.x`);
    finite(drag[key]?.y, `drag.${key}.y`);
    if (
      drag[key].x < 0 ||
      drag[key].x >= run.renderingSettings.viewportWidth ||
      drag[key].y < 0 ||
      drag[key].y >= run.renderingSettings.viewportHeight
    )
      throw new Error(
        `CCTV native drag ${key} coordinate is outside the viewport.`,
      );
  }
  assertCalibration(drag.calibrationBefore, 'drag before');
  assertCalibration(drag.calibrationAfter, 'drag after');
  if (!exactJson(drag.calibrationBefore, run.initialCalibration))
    throw new Error('CCTV drag baseline differs from initial calibration.');
  const actualChangedFields = changedCalibrationFields(
    drag.calibrationBefore,
    drag.calibrationAfter,
  );
  if (
    !actualChangedFields.includes('offsetEastM') ||
    !exactJson([...actualChangedFields].sort(), [...drag.changedFields].sort())
  )
    throw new Error('CCTV drag changed-field evidence does not match values.');
  digest(drag.geometrySha256After, 'post-drag gizmo geometry');
  const settlement = drag.geometrySettlement;
  if (
    settlement?.status !== 'passed' ||
    settlement.timeoutMs !== 2000 ||
    settlement.forcedFrames !== 0 ||
    !Number.isFinite(settlement.releaseAtMs) ||
    !Number.isFinite(settlement.readyFrameAtMs) ||
    settlement.readyFrameAtMs < settlement.releaseAtMs ||
    settlement.readyFrameAtMs - settlement.releaseAtMs >=
      settlement.timeoutMs ||
    !Number.isFinite(settlement.elapsedMs) ||
    settlement.elapsedMs < 0 ||
    settlement.elapsedMs >= settlement.timeoutMs
  )
    throw new Error(
      'CCTV edited geometry did not settle naturally after release.',
    );
  assertForegroundConditions(
    drag.conditions,
    {
      width: run.renderingSettings.viewportWidth,
      height: run.renderingSettings.viewportHeight,
      devicePixelRatio: run.viewport.devicePixelRatio,
    },
    {
      completedPhase: 'after-frame-capture',
      minimumDurationMs: 1,
      expectedLayout: run.layoutEvidence.settled,
    },
  );

  digest(run.beforePixels?.sha256, 'before-frame');
  digest(run.afterPixels?.sha256, 'after-frame');
  for (const pixels of [run.beforePixels, run.afterPixels]) {
    integer(pixels.width, 'pixel width', { min: 1 });
    integer(pixels.height, 'pixel height', { min: 1 });
    integer(pixels.nonBackgroundPixels, 'non-background pixel', { min: 1 });
    if (
      pixels.captureState?.dataSourceDisplayReady !== true ||
      pixels.captureState?.currentVisualizerUpdateReady !== true
    )
      throw new Error('CCTV capture preceded complete visualizer geometry.');
    for (const field of ['position', 'direction', 'up']) {
      if (!exactJson(pixels.captureState?.[field], run.camera[field]))
        throw new Error(
          'CCTV calibration drag changed the viewer camera pose.',
        );
    }
  }
  if (
    run.beforePixels.width !== run.renderingSettings.drawingBufferWidth ||
    run.beforePixels.height !== run.renderingSettings.drawingBufferHeight ||
    run.afterPixels.width !== run.beforePixels.width ||
    run.afterPixels.height !== run.beforePixels.height
  )
    throw new Error(
      'CCTV calibration pixel dimensions do not match the drawing buffer.',
    );
  if (run.beforePixels.sha256 === run.afterPixels.sha256)
    throw new Error(
      'CCTV accepted drag did not change the rendered fixture pixels.',
    );
  assertCleanup(run.cleanup, 'trial');
}

/** Compare one control/candidate pair without accepting a fabricated summary. */
export function compareCctvCalibrationPair(pair) {
  if (!Array.isArray(pair?.runs) || pair.runs.length !== 2)
    throw new Error('CCTV calibration pair must retain both raw trials.');
  const [first, second] = pair.runs;
  const legacy = first.mode === 'legacy-control' ? first : second;
  const candidate = first.mode === 'candidate' ? first : second;
  if (
    !legacy ||
    !candidate ||
    legacy.mode !== 'legacy-control' ||
    candidate.mode !== 'candidate'
  )
    throw new Error('CCTV calibration pair is missing one representation.');
  if (
    legacy.fixtureSha256 !== candidate.fixtureSha256 ||
    legacy.applicationCommit !== candidate.applicationCommit ||
    legacy.harnessCommit !== candidate.harnessCommit ||
    legacy.environment?.renderer !== candidate.environment?.renderer ||
    !exactJson(legacy.viewport, candidate.viewport) ||
    !exactJson(
      equivalentMeasuredSettings(legacy),
      equivalentMeasuredSettings(candidate),
    ) ||
    !exactJson(legacy.camera, candidate.camera) ||
    !exactJson(legacy.initialCalibration, candidate.initialCalibration) ||
    legacy.beforePixels?.sha256 !== candidate.beforePixels?.sha256 ||
    legacy.afterPixels?.sha256 !== candidate.afterPixels?.sha256 ||
    legacy.drag?.geometrySha256After !== candidate.drag?.geometrySha256After ||
    !exactJson(
      legacy.drag?.calibrationAfter,
      candidate.drag?.calibrationAfter,
    ) ||
    !exactJson(legacy.drag?.from, candidate.drag?.from) ||
    !exactJson(legacy.drag?.to, candidate.drag?.to) ||
    !exactJson(legacy.drag?.changedFields, candidate.drag?.changedFields)
  )
    throw new Error('CCTV calibration control and candidate outputs differ.');
  return {
    schema: 'gev-cctv-calibration-pair/v1',
    status: 'passed',
    pair: pair.pair,
    fixtureSha256: legacy.fixtureSha256,
    beforePixelsSha256: legacy.beforePixels.sha256,
    afterPixelsSha256: legacy.afterPixels.sha256,
    geometrySha256: legacy.camera.geometrySha256,
    controlIdleFrames: legacy.idle.completedFrames,
    candidateIdleFrames: candidate.idle.completedFrames,
    idleFrameReduction:
      1 - candidate.idle.completedFrames / legacy.idle.completedFrames,
  };
}

/** Validate actual alternating native-viewer trials; no self-certified summary is accepted. */
export function validateCctvCalibrationDemandReport(
  report,
  { expectedCommit } = {},
) {
  if (!report || report.schema !== 'gev-cctv-calibration-render-demand/v1')
    throw new Error('Unsupported CCTV calibration demand report.');
  if (
    report.status !== 'passed' ||
    report.error ||
    report.failedPhase ||
    report.phase !== 'complete' ||
    report.fixture?.id !== 'cctv-calibration-native-drag/v1' ||
    report.scope !==
      'isolated production CCTV layer; native calibration input and render-demand comparison'
  )
    throw new Error('CCTV calibration report is incomplete or failed.');
  if (
    !SHA1.test(expectedCommit || '') ||
    report.applicationCommit !== expectedCommit ||
    report.harnessCommit !== expectedCommit
  )
    throw new Error('CCTV calibration report source identity differs.');
  digest(report.fixture?.sha256, 'fixture');
  if (
    report.fixture.cameraId !== 'qa-cctv-calibration-camera-001' ||
    report.fixture.epochMs !== Date.UTC(2026, 9, 8, 12) ||
    report.fixture.idleRequestedMs !== IDLE_REQUESTED_MS
  )
    throw new Error('CCTV calibration fixture settings are incomplete.');
  if (
    typeof report.environment?.renderer !== 'string' ||
    !report.environment.renderer.trim()
  )
    throw new Error(
      'CCTV calibration report lacks observed renderer identity.',
    );
  if (
    typeof report.environment.userAgent !== 'string' ||
    !report.environment.userAgent.trim() ||
    typeof report.environment.maskedRenderer !== 'string' ||
    !['unmasked-extension', 'masked-fallback'].includes(
      report.environment.rendererIdentity,
    )
  )
    throw new Error('CCTV calibration report lacks browser/graphics identity.');
  if (report.environment.desktopForegroundVerification !== 'unavailable')
    throw new Error('CCTV desktop foreground evidence is mislabeled.');
  assertViewport(report.viewport, 'report');
  for (const field of [
    'cssWidth',
    'cssHeight',
    'viewportWidth',
    'viewportHeight',
  ]) {
    finite(report.viewport[field], `report.${field}`);
    if (report.viewport[field] <= 0)
      throw new Error(`CCTV calibration report ${field} is invalid.`);
  }
  if (!Array.isArray(report.pairs) || report.pairs.length !== PAIR_COUNT)
    throw new Error('CCTV calibration pair inventory is incomplete.');
  const reportStart = Date.parse(report.startedAt);
  const reportFinish = Date.parse(report.finishedAt);
  if (
    !Number.isFinite(reportStart) ||
    !Number.isFinite(reportFinish) ||
    reportFinish < reportStart
  )
    throw new Error('CCTV calibration report timestamps are invalid.');

  let candidateTotal = 0;
  let legacyTotal = 0;
  const instructionIds = new Set();
  const allRuns = [];
  let referenceRun = null;
  for (let index = 0; index < PAIR_COUNT; index++) {
    const pair = report.pairs[index];
    const expectedOrder =
      index % 2
        ? ['candidate', 'legacy-control']
        : ['legacy-control', 'candidate'];
    if (
      pair?.pair !== index ||
      !Array.isArray(pair.order) ||
      !exactJson(pair.order, expectedOrder) ||
      !Array.isArray(pair.runs) ||
      pair.runs.length !== 2 ||
      !pair.runs.every((run, runIndex) => run?.mode === expectedOrder[runIndex])
    )
      throw new Error(
        `CCTV calibration pair ${index} identity/order is invalid.`,
      );
    for (const run of pair.runs) {
      assertRun(run, expectedCommit, report);
      const runStartedAt = Date.parse(run.startedAt);
      if (runStartedAt < reportStart || runStartedAt > reportFinish)
        throw new Error(
          'CCTV calibration trial timestamp falls outside the report.',
        );
      if (run.pair !== index || instructionIds.has(run.drag.instructionId))
        throw new Error(
          `CCTV calibration trial ${index} identity is duplicated or misplaced.`,
        );
      if (referenceRun) {
        if (
          !exactJson(run.viewport, referenceRun.viewport) ||
          !exactJson(
            run.layoutEvidence?.settled,
            referenceRun.layoutEvidence?.settled,
          ) ||
          !exactJson(
            equivalentMeasuredSettings(run),
            equivalentMeasuredSettings(referenceRun),
          ) ||
          run.environment.renderer !== referenceRun.environment.renderer ||
          run.environment.userAgent !== referenceRun.environment.userAgent ||
          !exactJson(run.camera, referenceRun.camera) ||
          !exactJson(run.initialCalibration, referenceRun.initialCalibration)
        )
          throw new Error(
            'CCTV calibration fixture identity/settings drifted between trials.',
          );
      } else {
        referenceRun = run;
      }
      instructionIds.add(run.drag.instructionId);
      allRuns.push(run);
    }
    const [first, second] = pair.runs;
    const legacy = first.mode === 'legacy-control' ? first : second;
    const candidate = first.mode === 'candidate' ? first : second;
    if (
      legacy.fixtureSha256 !== candidate.fixtureSha256 ||
      legacy.renderingSettings.drawingBufferWidth !==
        candidate.renderingSettings.drawingBufferWidth ||
      legacy.renderingSettings.drawingBufferHeight !==
        candidate.renderingSettings.drawingBufferHeight ||
      legacy.renderingSettings.msaaSamples !==
        candidate.renderingSettings.msaaSamples ||
      legacy.environment.renderer !== candidate.environment.renderer
    )
      throw new Error(
        `CCTV calibration pair ${index} environment/settings differ.`,
      );
    const actualComparison = compareCctvCalibrationPair(pair);
    if (
      !pair.comparison ||
      pair.comparison.schema !== actualComparison.schema ||
      pair.comparison.status !== 'passed' ||
      pair.comparison.pair !== index ||
      pair.comparison.fixtureSha256 !== actualComparison.fixtureSha256 ||
      pair.comparison.beforePixelsSha256 !==
        actualComparison.beforePixelsSha256 ||
      pair.comparison.afterPixelsSha256 !==
        actualComparison.afterPixelsSha256 ||
      pair.comparison.geometrySha256 !== actualComparison.geometrySha256 ||
      pair.comparison.controlIdleFrames !==
        actualComparison.controlIdleFrames ||
      pair.comparison.candidateIdleFrames !==
        actualComparison.candidateIdleFrames ||
      pair.comparison.idleFrameReduction !== actualComparison.idleFrameReduction
    )
      throw new Error(
        `CCTV calibration pair ${index} comparison is missing or inconsistent.`,
      );
    legacyTotal += legacy.idle.completedFrames;
    candidateTotal += candidate.idle.completedFrames;
  }
  if (!(candidateTotal < legacyTotal))
    throw new Error(
      'CCTV calibration showed no repeatable idle-frame reduction.',
    );
  if (
    report.cleanup?.trials !== RUN_COUNT ||
    report.cleanup?.allTrialsReleased !== true ||
    report.cleanup?.viewerDestroyedCount !== RUN_COUNT ||
    report.cleanup?.governorUninstalledCount !== RUN_COUNT ||
    allRuns.some(
      (run) => !run.cleanup.viewerDestroyed || !run.cleanup.governorUninstalled,
    )
  )
    throw new Error('CCTV calibration aggregate cleanup is incomplete.');
  return {
    status: 'passed',
    pairCount: PAIR_COUNT,
    legacyIdleFrames: legacyTotal,
    candidateIdleFrames: candidateTotal,
  };
}
