import * as Cesium from 'cesium';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMotion } from '../../src/layers/flights/motion.js';
import { createTracking } from '../../src/layers/flights/tracking.js';

const AIRCRAFT = 'abc123';
const OTHER_AIRCRAFT = 'def456';
const EPOCH_MS = Date.UTC(2026, 9, 8, 12, 0, 0);

function createFixture({ frameNumber = 1, includeFrame = true } = {}) {
  const history = (longitude) => {
    const firstTime = Cesium.JulianDate.fromDate(new Date(EPOCH_MS));
    const secondTime = Cesium.JulianDate.addSeconds(
      firstTime,
      120,
      new Cesium.JulianDate(),
    );
    return [
      {
        time: firstTime,
        position: Cesium.Cartesian3.fromDegrees(longitude, 30.27, 1500),
        velocity: 100,
        track: 90,
        epochMs: EPOCH_MS,
      },
      {
        time: secondTime,
        position: Cesium.Cartesian3.fromDegrees(longitude + 0.11, 30.27, 1500),
        velocity: 100,
        track: 90,
        epochMs: EPOCH_MS + 120_000,
      },
    ];
  };
  const data = new Map([
    [AIRCRAFT, { velocity: 100, true_track: 90, klass: 'aircraft' }],
    [OTHER_AIRCRAFT, { velocity: 100, true_track: 90, klass: 'aircraft' }],
  ]);
  const flightState = {
    records: { data },
    _positionHistory: new Map([
      [AIRCRAFT, history(-97.74)],
      [OTHER_AIRCRAFT, history(-97.2)],
    ]),
    _viewer: {
      scene: {
        ...(includeFrame ? { frameState: { frameNumber } } : {}),
      },
    },
    _trackedIcao: AIRCRAFT,
    _cachedDRPosition: null,
    _cachedDRFrame: -1,
    _trackedFrameRenderTime: new Cesium.JulianDate(),
    _trackedFrameTimeFrame: -1,
    _trackedFrameTimeIcao: null,
    _cachedDRCourse: null,
    _cachedDRSpeedMps: null,
    _cachedDRHold: false,
    _drReconcileValid: false,
    _drReconcileIcao: null,
    _drCourseDeg: null,
    _drSpeedMps: null,
    _drCourseHold: false,
    _drExtrapolating: false,
    _scratchRenderTime: new Cesium.JulianDate(),
    _scratchTrackedRenderTime: new Cesium.JulianDate(),
    _scratchWarmupTime: new Cesium.JulianDate(),
    _scratchDrRaw: new Cesium.Cartesian3(),
    _scratchArc: { east: 0, north: 0, endCourseDeg: 0 },
    _scratchOffset: new Cesium.Cartesian3(),
    _scratchEnu: new Cesium.Matrix4(),
    _trackedPosHolder: new Cesium.Cartesian3(),
    _drCorrection: new Cesium.Cartesian3(),
    _drCorrectionStartMs: 0,
    _drPrevRaw: new Cesium.Cartesian3(),
    _drPrevDisplay: new Cesium.Cartesian3(),
    _drPrevMs: 0,
    _displayFloorState: new Map(),
    _displayCourse: new Map(),
    _trackedCourseMs: 0,
    _scratchDisplayCarto: new Cesium.Cartographic(),
  };
  let focusPublishCount = 0;
  const services = {
    groundFloor: {
      cachedGroundFloor: () => null,
      GROUND_FLOOR_LIFT_M: 0,
      neighborFloorM: () => null,
      stickyFloorCell: (lat, lon) => ({ lat, lon }),
      displayFloorHeightM: () => null,
      coarseFloorCoord: (point) => point,
      corridorFloorCells: (points) => points,
      allocateCorridorCells: () => [],
    },
    camera: { trackedModelScaleForPixelCap: () => 1 },
    focus: {
      nearFarScalarValueAtDistance: () => 1,
      clearFocusTarget() {},
      publishFocusTargetFromCachedPosition() {
        focusPublishCount += 1;
      },
    },
  };
  const parts = { rendering: { _modelOwnsVisual: () => false } };
  return {
    flightState,
    motion: createMotion({ flightState, services, parts }),
    focusPublishCount: () => focusPublishCount,
  };
}

function createTrailCallbackFixture({ includeFrame = true } = {}) {
  const fixture = createFixture({ includeFrame });
  const { flightState, motion } = fixture;
  let trailHead;
  flightState._viewer.entities = {
    add(entity) {
      trailHead = entity;
      return entity;
    },
  };
  flightState._trailBackfillToken = 0;
  flightState._trailPositions = [];
  flightState._trail = null;
  flightState._trailHeadEntity = null;
  flightState._trailHeadSeq = 0;
  flightState._cockpitContactMode = false;
  flightState.lifetime = new AbortController();
  flightState.feed = { _source: {}, _lastSource: null };
  flightState._scratchTrailHead = new Cesium.Cartesian3();
  const services = {
    context: {
      selectTrackedSubjectContext() {},
      clearTrackedSubjectContext() {},
      refreshTrackedSubjectContext() {},
    },
    aircraftPresentation: {
      isTr3b: () => false,
      tr3bTypeLabel: () => '',
      tr3bConvertedIds: () => [],
    },
    trails: {
      createTrail() {
        return { setVisible() {}, setPositions() {} };
      },
    },
    geoid: { ensureGeoidReady: async () => {}, geoidHeight: () => 0 },
    groundFloor: {
      resolveGroundFloorCellsBounded: async () => {},
      floorAltitudeM: () => null,
      cachedGroundFloor: () => null,
    },
    focus: { clearFocusTarget() {} },
    militaryRegistry: {
      isMilitaryLayerActive: () => false,
      isMilitaryIcao: () => false,
    },
    readout: {
      trackedLabelModelFromText: () => null,
      refreshTrackedReadout() {},
    },
    camera: { applyTrackedCameraFrame() {} },
    picking: { resolvePickId: () => null, isOwnedByOtherLayer: () => false },
  };
  const tracking = createTracking({
    flightState,
    services,
    parts: { motion },
    layer: {},
    resolveAsset: (url) => url,
  });
  tracking._startTrail(AIRCRAFT);
  // The body may already contain its bounded backfill; two stable prior body
  // points make the live-head CallbackProperty take its real evaluation path.
  flightState._trailPositions = [
    Cesium.Cartesian3.fromDegrees(-97.75, 30.26, 1500),
    Cesium.Cartesian3.fromDegrees(-97.74, 30.27, 1500),
  ];
  return {
    ...fixture,
    tracking,
    evaluateTrailHead: () =>
      trailHead.polyline.positions.getValue(
        Cesium.JulianDate.fromDate(new Date(EPOCH_MS + 30_000)),
      ),
  };
}

function at(secondsFromFix) {
  return Cesium.JulianDate.addSeconds(
    Cesium.JulianDate.fromDate(new Date(EPOCH_MS)),
    secondsFromFix,
    new Cesium.JulianDate(),
  );
}

function installClock(times, dateNowMs = EPOCH_MS + 100_000) {
  const originalJulianNow = Cesium.JulianDate.now;
  const originalDateNow = Date.now;
  let calls = 0;
  let dateCalls = 0;
  const sampledTimesSeconds = [];
  Cesium.JulianDate.now = (result) => {
    const time = times[Math.min(calls, times.length - 1)];
    calls += 1;
    sampledTimesSeconds.push(Cesium.JulianDate.secondsDifference(time, at(0)));
    return Cesium.JulianDate.clone(time, result || new Cesium.JulianDate());
  };
  Date.now = () => {
    dateCalls += 1;
    return dateNowMs;
  };
  return {
    calls: () => calls,
    dateCalls: () => dateCalls,
    sampledTimesSeconds: () => [...sampledTimesSeconds],
    restore: () => {
      Cesium.JulianDate.now = originalJulianNow;
      Date.now = originalDateNow;
    },
  };
}

function poseDistance(a, b) {
  return Cesium.Cartesian3.distance(a, b);
}

function poseEcefM(position) {
  return position ? [position.x, position.y, position.z] : null;
}

function positionFirstBoundaryCase() {
  const { flightState, motion, evaluateTrailHead } =
    createTrailCallbackFixture();
  const clock = installClock([at(29.5), at(30.5)]);
  try {
    // Mirrors Cesium's tracked entity position callback preceding the trail callback.
    const positionSample = motion._trackedDisplayPosition(AIRCRAFT);
    const trailResult = evaluateTrailHead();
    const trailCallbackReturnedSegment = trailResult.length > 0;
    const trailPosition = trailResult.at(-1);
    const fresh = createFixture();
    const freshClock = installClock([at(30.5)]);
    let freshPosition;
    try {
      freshPosition = fresh.motion._trackedDisplayPosition(AIRCRAFT);
    } finally {
      freshClock.restore();
    }
    return {
      callbackOrder: ['tracked-position', 'trail-head'],
      authoritativeTimeSamples: clock.calls(),
      sampledTimesSeconds: clock.sampledTimesSeconds(),
      expectedPoseTimeFromFirstSampleSeconds:
        clock.sampledTimesSeconds()[0] - 30,
      trailCallbackReturnedSegment,
      trackedPoseEcefM: poseEcefM(positionSample),
      trackedCourseDeg: flightState._drCourseDeg,
      trackedSpeedMps: flightState._drSpeedMps,
      trailEndpointDeltaFromPositionM: trailPosition
        ? poseDistance(trailPosition, positionSample)
        : null,
      syntheticPoseDeltaAcrossOneSecondInputM: poseDistance(
        positionSample,
        freshPosition,
      ),
    };
  } finally {
    clock.restore();
  }
}

function trailFirstBoundaryCase() {
  const { flightState, motion, evaluateTrailHead } =
    createTrailCallbackFixture();
  const clock = installClock([at(29.5), at(30.5)]);
  try {
    // Mirrors the trail callback arriving before the tracked position callback.
    const trailResult = evaluateTrailHead();
    const trailCallbackSuppressed = trailResult.length === 0;
    const positionSample = motion._trackedDisplayPosition(AIRCRAFT);
    return {
      callbackOrder: ['trail-head', 'tracked-position'],
      authoritativeTimeSamples: clock.calls(),
      sampledTimesSeconds: clock.sampledTimesSeconds(),
      trailCallbackSuppressed,
      expectedPoseTimeFromFirstSampleSeconds:
        clock.sampledTimesSeconds()[0] - 30,
      positionWasComputed: Boolean(positionSample),
      trackedPoseEcefM: poseEcefM(positionSample),
      trackedCourseDeg: flightState._drCourseDeg,
      trackedSpeedMps: flightState._drSpeedMps,
      trackedFrame: flightState._cachedDRFrame,
    };
  } finally {
    clock.restore();
  }
}

function invalidFrameTrailFirstPairingCase() {
  const { flightState, motion, evaluateTrailHead } = createTrailCallbackFixture(
    { includeFrame: false },
  );
  const clock = installClock([at(40.5), at(50.5)]);
  try {
    const trailResult = evaluateTrailHead();
    return {
      authoritativeTimeSamples: clock.calls(),
      sampledTimesSeconds: clock.sampledTimesSeconds(),
      callbackReturnedSegment: trailResult.length > 0,
      sameCallRenderTimePassedToPose:
        Cesium.JulianDate.secondsDifference(
          flightState._scratchTrackedRenderTime,
          at(0),
        ) === 10.5,
      frameTimeWasNotCached: flightState._trackedFrameTimeFrame === -1,
      reconciliationCompleted: flightState._drReconcileValid,
    };
  } finally {
    clock.restore();
  }
}

function invalidFrameWarmupFreshnessCase() {
  const { motion } = createFixture({ includeFrame: false });
  const clock = installClock([at(29.5), at(30.5)]);
  try {
    const first = motion._isTrackWarmingUp();
    const second = motion._isTrackWarmingUp();
    return {
      authoritativeTimeSamples: clock.calls(),
      sampledTimesSeconds: clock.sampledTimesSeconds(),
      decisions: [first, second],
      secondCheckUsesFreshSample: first === true && second === false,
    };
  } finally {
    clock.restore();
  }
}

function invalidFrameCachedPoseCase() {
  const { flightState, motion, evaluateTrailHead } = createTrailCallbackFixture(
    { includeFrame: false },
  );
  const clock = installClock([at(80), at(81)]);
  try {
    const renderedPose = motion._trackedDisplayPosition(AIRCRAFT);
    const trailResult = evaluateTrailHead();
    return {
      authoritativeTimeSamples: clock.calls(),
      cachedPoseTimeReusedByTrail: clock.calls() === 1,
      frameTimeWasNotCached: flightState._trackedFrameTimeFrame === -1,
      trailPoseMatchesRenderedPose:
        poseDistance(trailResult.at(-1), renderedPose) < 1e-6,
    };
  } finally {
    clock.restore();
  }
}

function laterPostRenderCacheCase() {
  const { flightState, motion, focusPublishCount, evaluateTrailHead } =
    createTrailCallbackFixture();
  const clock = installClock([at(80), at(81)]);
  try {
    const renderedPose = motion._trackedDisplayPosition(AIRCRAFT);
    const focusWritesBeforeObservers = focusPublishCount();
    const timeSamplesBeforeObservers = clock.calls();
    flightState._viewer.scene.frameState.frameNumber += 1;
    const postRenderPose = motion._trackedDisplayCached();
    const trailPose = motion._trackedTrailCached();
    const visualPose = motion._trackedVisualCached();
    const trailCallbackResult = evaluateTrailHead();
    return {
      firstFrame: 1,
      observerFrame: flightState._viewer.scene.frameState.frameNumber,
      authoritativeTimeSamples: clock.calls(),
      sampledTimesSeconds: clock.sampledTimesSeconds(),
      observerReusesRenderedPose: postRenderPose === renderedPose,
      trailReusesRenderedPose: trailPose === renderedPose,
      visualReusesRenderedPose: visualPose === renderedPose,
      laterTrailCallbackUsesRenderedPose:
        poseDistance(trailCallbackResult.at(-1), renderedPose) < 1e-6,
      cacheOnlyObserversAddedTimeSamples:
        clock.calls() - timeSamplesBeforeObservers,
      cacheOnlyObserversAddedFocusWrites:
        focusPublishCount() - focusWritesBeforeObservers,
    };
  } finally {
    clock.restore();
  }
}

function interpolationAndExtrapolationCase() {
  const { flightState, motion } = createFixture();
  const clock = installClock([at(90), at(200)]);
  try {
    motion._trackedDisplayPosition(AIRCRAFT);
    const interpolated = flightState._drExtrapolating === false;
    flightState._viewer.scene.frameState.frameNumber += 1;
    motion._trackedDisplayPosition(AIRCRAFT);
    const extrapolated = flightState._drExtrapolating === true;
    return {
      authoritativeTimeSamples: clock.calls(),
      interpolationPathObserved: interpolated,
      coastingExtrapolationPathObserved: extrapolated,
    };
  } finally {
    clock.restore();
  }
}

function targetResetCase() {
  const { flightState, motion } = createFixture();
  const clock = installClock([at(80), at(81)]);
  try {
    const oldTargetPose = Cesium.Cartesian3.clone(
      motion._trackedDisplayPosition(AIRCRAFT),
    );
    flightState._trackedIcao = OTHER_AIRCRAFT;
    motion._resetTrackedDisplay();
    const newTargetPose = motion._trackedDisplayPosition(OTHER_AIRCRAFT);
    return {
      targetChanged: flightState._drReconcileIcao === OTHER_AIRCRAFT,
      targetPoseDistanceM: poseDistance(oldTargetPose, newTargetPose),
      authoritativeTimeSamples: clock.calls(),
      sampledTimesSeconds: clock.sampledTimesSeconds(),
    };
  } finally {
    clock.restore();
  }
}

function untrackedScratchOwnershipCase() {
  const { flightState, motion } = createFixture();
  const clock = installClock([at(80), at(81), at(82)]);
  try {
    motion._trackedDisplayPosition(AIRCRAFT);
    const trackedRenderTime = Cesium.JulianDate.clone(
      flightState._trackedFrameRenderTime,
      new Cesium.JulianDate(),
    );
    // Fleet/query callers use the same _deadReckon helper and its shared scratch.
    motion._deadReckon(OTHER_AIRCRAFT, new Cesium.Cartesian3());
    const scratchAfterUntrackedQuery = Cesium.JulianDate.clone(
      flightState._scratchRenderTime,
      new Cesium.JulianDate(),
    );
    const trackedTimeAfterUntracked = Cesium.JulianDate.clone(
      flightState._trackedFrameRenderTime,
      new Cesium.JulianDate(),
    );
    const trailWarmupDecision = motion._isTrackWarmingUp();
    return {
      authoritativeTimeSamples: clock.calls(),
      dateNowSamples: clock.dateCalls(),
      untrackedCallOverwroteSharedRenderScratch: !Cesium.JulianDate.equals(
        trackedRenderTime,
        scratchAfterUntrackedQuery,
      ),
      trackedTimeRemainedOwned: Cesium.JulianDate.equals(
        trackedRenderTime,
        trackedTimeAfterUntracked,
      ),
      trackedTimeAtSecOfDay: trackedRenderTime.secondsOfDay,
      scratchAfterUntrackedAtSecOfDay: scratchAfterUntrackedQuery.secondsOfDay,
      trailWarmupDecision,
    };
  } finally {
    clock.restore();
  }
}

function missingFrameNumberCase() {
  const { flightState, motion } = createFixture({ includeFrame: false });
  const clock = installClock([at(80), at(81)]);
  try {
    motion._trackedDisplayPosition(AIRCRAFT);
    const firstRaw = Cesium.Cartesian3.clone(flightState._drPrevRaw);
    motion._trackedDisplayPosition(AIRCRAFT);
    const secondRaw = flightState._drPrevRaw;
    return {
      frameNumberFallback: -1,
      authoritativeTimeSamples: clock.calls(),
      freshRawPoseDistanceM: poseDistance(firstRaw, secondRaw),
    };
  } finally {
    clock.restore();
  }
}

function negativeFrameNumberCase() {
  const { flightState, motion } = createFixture({ frameNumber: -1 });
  const clock = installClock([at(80), at(81)]);
  try {
    motion._trackedDisplayPosition(AIRCRAFT);
    const firstRaw = Cesium.Cartesian3.clone(flightState._drPrevRaw);
    motion._trackedDisplayPosition(AIRCRAFT);
    return {
      frameNumber: -1,
      authoritativeTimeSamples: clock.calls(),
      freshRawPoseDistanceM: poseDistance(firstRaw, flightState._drPrevRaw),
    };
  } finally {
    clock.restore();
  }
}

function insufficientTrailBodyCase() {
  const { flightState, evaluateTrailHead } = createTrailCallbackFixture();
  flightState._trailPositions.length = 1;
  const clock = installClock([at(80)]);
  try {
    const trailResult = evaluateTrailHead();
    return {
      authoritativeTimeSamples: clock.calls(),
      callbackSuppressedWithoutSampling:
        trailResult.length === 0 && clock.calls() === 0,
    };
  } finally {
    clock.restore();
  }
}

function untrackedQueryFreshnessCase() {
  const { motion } = createFixture();
  const clock = installClock([at(80), at(81)]);
  try {
    const first = motion._deadReckon(OTHER_AIRCRAFT, new Cesium.Cartesian3());
    const second = motion._deadReckon(OTHER_AIRCRAFT, new Cesium.Cartesian3());
    return {
      authoritativeTimeSamples: clock.calls(),
      freshPositionDistanceM: poseDistance(first, second),
      directQueryRemainsUncached: first !== second,
    };
  } finally {
    clock.restore();
  }
}

export function runTrackedFrameTimeReproduction() {
  return {
    schema: 'gev-tracked-frame-time-reproduction/v1',
    classification: 'diagnostic-only-synthetic-clock',
    sourceScope: 'production createMotion helpers; no browser or renderer',
    baselineFinding:
      'Independent trail-warmup and tracked-pose samples can disagree within one rendered frame.',
    timingLimit:
      'Synthetic controlled timestamps demonstrate ownership/order behavior; distance deltas are not real observed aircraft motion.',
    controlledClock: {
      epoch: new Date(EPOCH_MS).toISOString(),
      nativeDateNow: 'held constant by harness',
      julianNowSamples: 'explicit per-case deterministic sequence',
      rendererTiming: 'not measured',
    },
    cases: {
      positionFirst: positionFirstBoundaryCase(),
      trailFirst: trailFirstBoundaryCase(),
      invalidFrameTrailFirstPairing: invalidFrameTrailFirstPairingCase(),
      invalidFrameWarmupFreshness: invalidFrameWarmupFreshnessCase(),
      invalidFrameCachedPose: invalidFrameCachedPoseCase(),
      laterPostRenderCache: laterPostRenderCacheCase(),
      interpolationAndExtrapolation: interpolationAndExtrapolationCase(),
      targetReset: targetResetCase(),
      untrackedScratchOwnership: untrackedScratchOwnershipCase(),
      missingFrameNumber: missingFrameNumberCase(),
      negativeFrameNumber: negativeFrameNumberCase(),
      insufficientTrailBody: insufficientTrailBodyCase(),
      untrackedQuery: untrackedQueryFreshnessCase(),
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const report = runTrackedFrameTimeReproduction();
  const output = process.argv[2];
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(output, serialized, { flag: 'wx' });
  } else {
    process.stdout.write(serialized);
  }
}
