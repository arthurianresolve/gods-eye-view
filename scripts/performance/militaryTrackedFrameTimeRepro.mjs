import * as Cesium from 'cesium';
import { createMotion } from '../../src/layers/military/motion.js';
import { createTracking } from '../../src/layers/military/tracking.js';

const ICAO = 'abc123';
const OTHER_ICAO = 'def456';
const EPOCH_MS = Date.UTC(2026, 9, 8, 12, 0, 0);

function createFixture({ frameNumber = 1, modelOwned = false } = {}) {
  const firstTime = Cesium.JulianDate.fromDate(new Date(EPOCH_MS));
  const secondTime = Cesium.JulianDate.addSeconds(
    firstTime,
    120,
    new Cesium.JulianDate(),
  );
  const makeHistory = (longitude) => [
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
  const flightState = {
    records: {
      data: new Map([
        [
          ICAO,
          {
            speedMps: 100,
            track: 90,
            klass: 'airplane',
            lastContactEpochMs: EPOCH_MS + 120_000,
          },
        ],
        [
          OTHER_ICAO,
          {
            speedMps: 80,
            track: 180,
            klass: 'airplane',
            lastContactEpochMs: EPOCH_MS + 120_000,
          },
        ],
      ]),
    },
    _positionHistory: new Map([
      [ICAO, makeHistory(-97.74)],
      [OTHER_ICAO, makeHistory(-97.2)],
    ]),
    _viewer: { scene: { frameState: { frameNumber } }, entities: null },
    _trackedIcao: ICAO,
    _trackedModel: null,
    _cachedDRPosition: null,
    _cachedDRFrame: -1,
    _cachedDRCourse: null,
    _cachedDRSpeedMps: null,
    _cachedDRHold: false,
    _drReconcileValid: false,
    _drReconcileIcao: null,
    _drCourseDeg: null,
    _drSpeedMps: null,
    _drCourseHold: false,
    _drCorrection: new Cesium.Cartesian3(),
    _drCorrectionStartMs: 0,
    _drPrevRaw: new Cesium.Cartesian3(),
    _drPrevDisplay: new Cesium.Cartesian3(),
    _drPrevMs: 0,
    _trackedPosHolder: new Cesium.Cartesian3(),
    _scratchDrRaw: new Cesium.Cartesian3(),
    _scratchArc: { east: 0, north: 0, endCourseDeg: 0 },
    _scratchOffset: new Cesium.Cartesian3(),
    _scratchEnu: new Cesium.Matrix4(),
    _scratchRenderTime: new Cesium.JulianDate(),
    _trackedFrameRenderTime: new Cesium.JulianDate(),
    _scratchTrackedRenderTime: new Cesium.JulianDate(),
    _trackedFrameTimeFrame: -1,
    _trackedFrameTimeIcao: null,
    _scratchWarmupTime: new Cesium.JulianDate(),
    _scratchTrailCarto: new Cesium.Cartographic(),
    _scratchTrailHead: new Cesium.Cartesian3(),
    _scratchTrailClip: new Cesium.Cartesian3(),
    _scratchModelBS: new Cesium.BoundingSphere(new Cesium.Cartesian3(), 1),
    _displayFloorState: new Map(),
    _displayCourse: new Map(),
    _trackedCourseMs: 0,
    _trailBackfillToken: 0,
    _trailPositions: [],
    _trail: null,
    _trailHeadEntity: null,
    _trailHeadSeq: 0,
    _cockpitContactMode: false,
    lifetime: new AbortController(),
    feed: { _source: {} },
    _billboards: new Map(),
  };
  let focusPublications = 0;
  const services = {
    camera: {
      trackedModelScaleForPixelCap: () => 1,
      applyTrackedCameraFrame() {},
    },
    focus: {
      nearFarScalarValueAtDistance: () => 1,
      clearFocusTarget() {},
      publishFocusTargetFromCachedPosition() {
        focusPublications += 1;
      },
    },
    context: {
      selectTrackedSubjectContext() {},
      clearTrackedSubjectContext() {},
      refreshTrackedSubjectContext() {},
    },
    aircraftPresentation: {
      tr3bTypeLabel: () => '',
      isTr3b: () => false,
      tr3bConvertedIds: () => [],
    },
    readout: {
      trackedLabelModelFromText: () => null,
      refreshTrackedReadout() {},
    },
    groundFloor: {
      floorAltitudeM: () => null,
      cachedGroundFloor: () => null,
      resolveGroundFloorCellsBounded: async () => {},
    },
    trails: {
      createTrail() {
        return { setVisible() {}, setPositions() {} };
      },
    },
    geoid: { ensureGeoidReady: async () => {}, geoidHeight: () => 0 },
    picking: { resolvePickId: () => null, isOwnedByOtherLayer: () => false },
  };
  const parts = {
    rendering: {
      _modelOwnsVisual: () => modelOwned,
      _modelSpec: () => ({
        scale: 1,
        nativeRadiusM: 1,
        trailAnchorNative: [0, 0, 0],
      }),
    },
  };
  const motion = createMotion({
    flightState,
    services,
    parts,
    layer: {},
    resolveAsset: (x) => x,
  });
  parts.motion = motion;
  const tracking = createTracking({
    flightState,
    services,
    parts,
    layer: {},
    resolveAsset: (x) => x,
  });
  let trailHead;
  flightState._viewer.entities = {
    add(entity) {
      trailHead = entity;
      return entity;
    },
  };
  tracking._startTrail(ICAO);
  // Keep two body points well behind the displayed head so the actual production
  // trail-head callback returns a segment once warmup allows it.
  flightState._trailPositions = [
    Cesium.Cartesian3.fromDegrees(-97.9, 30.27, 1500),
    Cesium.Cartesian3.fromDegrees(-97.8, 30.27, 1500),
  ];
  return {
    flightState,
    motion,
    evaluateTrailHead: () =>
      trailHead.polyline.positions.getValue(
        Cesium.JulianDate.fromDate(new Date(EPOCH_MS)),
      ),
    focusPublications: () => focusPublications,
  };
}

function at(seconds) {
  return Cesium.JulianDate.addSeconds(
    Cesium.JulianDate.fromDate(new Date(EPOCH_MS)),
    seconds,
    new Cesium.JulianDate(),
  );
}

function withClock(times, callback, dateNowTimes = [EPOCH_MS + 100_000]) {
  const originalNow = Cesium.JulianDate.now;
  const originalDateNow = Date.now;
  let index = 0;
  let dateIndex = 0;
  const sampledSeconds = [];
  Cesium.JulianDate.now = (result) => {
    const sample = times[Math.min(index, times.length - 1)];
    index += 1;
    sampledSeconds.push(Cesium.JulianDate.secondsDifference(sample, at(0)));
    return Cesium.JulianDate.clone(sample, result || new Cesium.JulianDate());
  };
  Date.now = () => {
    const now = dateNowTimes[Math.min(dateIndex, dateNowTimes.length - 1)];
    dateIndex += 1;
    return now;
  };
  try {
    return callback({
      calls: () => index,
      samples: () => [...sampledSeconds],
    });
  } finally {
    Cesium.JulianDate.now = originalNow;
    Date.now = originalDateNow;
  }
}

function positionFirst() {
  const fixture = createFixture();
  return withClock([at(14.5), at(15.5)], (clock) => {
    const position = fixture.motion._trackedDisplayPosition(ICAO);
    const trail = fixture.evaluateTrailHead();
    return {
      sampledTimesSeconds: clock.samples(),
      authoritativeTimeSamples: clock.calls(),
      trailReturnedSegment: trail.length > 0,
      positionEcefM: [position.x, position.y, position.z],
      courseDeg: fixture.flightState._drCourseDeg,
      speedMps: fixture.flightState._drSpeedMps,
      trailEndpointDeltaM: trail.length
        ? Cesium.Cartesian3.distance(trail.at(-1), position)
        : null,
      focusPublications: fixture.focusPublications(),
    };
  });
}

function trailFirst() {
  const fixture = createFixture();
  return withClock([at(14.5), at(15.5)], (clock) => {
    const trail = fixture.evaluateTrailHead();
    const position = fixture.motion._trackedDisplayPosition(ICAO);
    return {
      sampledTimesSeconds: clock.samples(),
      authoritativeTimeSamples: clock.calls(),
      trailReturnedSegment: trail.length > 0,
      positionEcefM: [position.x, position.y, position.z],
      courseDeg: fixture.flightState._drCourseDeg,
      speedMps: fixture.flightState._drSpeedMps,
      focusPublications: fixture.focusPublications(),
    };
  });
}

function laterFrameObserver() {
  const fixture = createFixture();
  return withClock([at(14.5), at(15.5)], (clock) => {
    const pose = fixture.motion._trackedDisplayPosition(ICAO);
    const focusBeforeObserver = fixture.focusPublications();
    fixture.flightState._viewer.scene.frameState.frameNumber += 1;
    const trail = fixture.evaluateTrailHead();
    return {
      authoritativeTimeSamples: clock.calls(),
      observerFrameNumber:
        fixture.flightState._viewer.scene.frameState.frameNumber,
      trailSuppressedForCachedWarmupPose: trail.length === 0,
      focusWritesFromObserver:
        fixture.focusPublications() - focusBeforeObserver,
      cachedPoseRemainsSame: fixture.motion._trackedDisplayCached() === pose,
    };
  });
}

function modelOwnedEndpoint() {
  const fixture = createFixture({ modelOwned: true });
  return withClock([at(45), at(46)], (clock) => {
    const pose = fixture.motion._trackedDisplayPosition(ICAO);
    fixture.flightState._trackedModel = {
      modelMatrix: Cesium.Matrix4.fromTranslation(pose, new Cesium.Matrix4()),
      computedScale: 1,
    };
    const trail = fixture.evaluateTrailHead();
    return {
      authoritativeTimeSamples: clock.calls(),
      trailReturnedSegment: trail.length === 2,
      modelOwnedEndpointDeltaM: trail.length
        ? Cesium.Cartesian3.distance(trail.at(-1), pose)
        : null,
    };
  });
}

function invalidFramePairingAndFreshness() {
  const paired = createFixture({ frameNumber: undefined });
  delete paired.flightState._viewer.scene.frameState.frameNumber;
  const pairedClock = withClock([at(45), at(46)], (clock) => {
    const trail = paired.evaluateTrailHead();
    return {
      authoritativeTimeSamples: clock.calls(),
      trailReturnedSegment: trail.length === 2,
      positionExists: paired.flightState._drReconcileValid,
      invalidFrameDidNotEnterPoseCache:
        paired.flightState._cachedDRFrame === -1,
      poseTimeAssociatedWithoutFrameNumber:
        paired.flightState._trackedFrameTimeIcao === ICAO &&
        paired.flightState._trackedFrameTimeFrame === -1,
    };
  });

  const observer = createFixture({ frameNumber: undefined });
  delete observer.flightState._viewer.scene.frameState.frameNumber;
  const observerClock = withClock([at(14.5), at(15.5)], (clock) => {
    observer.motion._trackedDisplayPosition(ICAO);
    const trail = observer.evaluateTrailHead();
    return {
      authoritativeTimeSamples: clock.calls(),
      trailSuppressedForCachedPoseTime: trail.length === 0,
      framePoseWasNotCached: observer.flightState._cachedDRFrame === -1,
    };
  });

  const standalone = createFixture({ frameNumber: undefined });
  delete standalone.flightState._viewer.scene.frameState.frameNumber;
  const standaloneClock = withClock([at(14.5), at(15.5)], (clock) => {
    const decisions = [
      standalone.motion._isTrackWarmingUp(),
      standalone.motion._isTrackWarmingUp(),
    ];
    return {
      authoritativeTimeSamples: clock.calls(),
      decisions,
      noInvalidFrameTimeCache:
        standalone.flightState._trackedFrameTimeFrame === -1 &&
        standalone.flightState._trackedFrameTimeIcao === null,
    };
  });

  const negative = createFixture({ frameNumber: -1 });
  const negativeClock = withClock([at(45), at(46)], (clock) => {
    negative.motion._trackedDisplayPosition(ICAO);
    negative.motion._trackedDisplayPosition(ICAO);
    return {
      authoritativeTimeSamples: clock.calls(),
      invalidFrameDidNotCachePosition:
        negative.flightState._cachedDRFrame === -1,
    };
  });
  return {
    paired: pairedClock,
    observer: observerClock,
    standalone: standaloneClock,
    negative: negativeClock,
  };
}

function resetAndUntrackedFreshness() {
  const fixture = createFixture();
  return withClock([at(45), at(46), at(47)], (clock) => {
    fixture.motion._trackedDisplayPosition(ICAO);
    const ownedTime = Cesium.JulianDate.clone(
      fixture.flightState._trackedFrameRenderTime,
      new Cesium.JulianDate(),
    );
    fixture.motion._deadReckon(OTHER_ICAO, new Cesium.Cartesian3());
    const untrackedUsedIndependentTime = !Cesium.JulianDate.equals(
      ownedTime,
      fixture.flightState._scratchRenderTime,
    );
    const trackedTimeWasNotMutated = Cesium.JulianDate.equals(
      ownedTime,
      fixture.flightState._trackedFrameRenderTime,
    );
    fixture.flightState._trackedIcao = OTHER_ICAO;
    fixture.motion._resetTrackedDisplay();
    fixture.motion._trackedDisplayPosition(OTHER_ICAO);
    return {
      authoritativeTimeSamples: clock.calls(),
      untrackedUsedIndependentTime,
      trackedTimeWasNotMutated,
      resetResampledTrackedTime: !Cesium.JulianDate.equals(
        ownedTime,
        fixture.flightState._trackedFrameRenderTime,
      ),
      resetClearedTimeIdentity:
        fixture.flightState._trackedFrameTimeIcao === OTHER_ICAO &&
        fixture.flightState._trackedFrameTimeFrame === 1,
      targetChangedForNextPose:
        fixture.flightState._drReconcileIcao === OTHER_ICAO,
    };
  });
}

function interpolationAndExtrapolation() {
  const fixture = createFixture();
  return withClock(
    [at(45), at(200)],
    (clock) => {
      const history = fixture.flightState._positionHistory.get(ICAO);
      const interpolated = Cesium.Cartesian3.clone(
        fixture.motion._trackedDisplayPosition(ICAO),
      );
      const expected = Cesium.Cartesian3.lerp(
        history[0].position,
        history[1].position,
        30 / 120,
        new Cesium.Cartesian3(),
      );
      fixture.flightState._viewer.scene.frameState.frameNumber += 1;
      const extrapolated = fixture.motion._trackedDisplayPosition(ICAO);
      return {
        authoritativeTimeSamples: clock.calls(),
        interpolationMatchesFixBracket:
          Cesium.Cartesian3.distance(interpolated, expected) < 1e-6,
        nextFrameAdvanced:
          Cesium.Cartesian3.distance(interpolated, extrapolated) > 0,
        extrapolatedBeyondNewestFix:
          Cesium.Cartesian3.distance(extrapolated, history.at(-1).position) > 0,
        focusPublications: fixture.focusPublications(),
      };
    },
    [EPOCH_MS + 45_000, EPOCH_MS + 200_000],
  );
}

export function runMilitaryTrackedFrameTimeReproduction() {
  return {
    schema: 'gev-military-tracked-frame-time-reproduction/v1',
    classification: 'diagnostic-only-synthetic-clock',
    sourceScope:
      'production military createMotion and createTracking trail CallbackProperty',
    timingLimit:
      'Controlled timestamp ordering only; no browser, renderer, or aircraft-motion claim.',
    cases: {
      positionFirst: positionFirst(),
      trailFirst: trailFirst(),
      laterFrameObserver: laterFrameObserver(),
      modelOwnedEndpoint: modelOwnedEndpoint(),
      invalidFrame: invalidFramePairingAndFreshness(),
      resetAndUntrackedFreshness: resetAndUntrackedFreshness(),
      interpolationAndExtrapolation: interpolationAndExtrapolation(),
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}`
) {
  process.stdout.write(
    `${JSON.stringify(runMilitaryTrackedFrameTimeReproduction(), null, 2)}\n`,
  );
}
