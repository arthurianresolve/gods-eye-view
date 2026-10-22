import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createMotion } from './motion.js';

function motionFixture(positionMode = 'recorded') {
  const flightState = {
    _positionSourceMode: positionMode,
    _positionHistory: new Map(),
    _focusEvidenceIds: new Set(),
    records: { data: new Map() },
    _scratchRenderTime: new Cesium.JulianDate(),
    _scratchDrRaw: new Cesium.Cartesian3(),
    _trackedPosHolder: new Cesium.Cartesian3(),
    _drCorrection: new Cesium.Cartesian3(),
    _drPrevRaw: new Cesium.Cartesian3(),
    _drPrevDisplay: new Cesium.Cartesian3(),
    _cachedDRPosition: null,
    _cachedDRFrame: -1,
    _drReconcileIcao: null,
    _drReconcileValid: false,
    _drCorrectionStartMs: 0,
    _drPrevMs: 0,
    _trackedIcao: 'SYNTH-001',
    _trackedFrameRenderTime: new Cesium.JulianDate(),
    _trackedFrameTimeFrame: -1,
    _trackedFrameTimeIcao: null,
    _viewer: { scene: { frameState: { frameNumber: 12 } } },
    _drCourseDeg: null,
    _drSpeedMps: null,
    _drCourseHold: false,
    _drExtrapolating: false,
  };
  const parts = {
    rendering: { _modelOwnsVisual: () => false },
    queries: { _approxDistanceKm: () => 0 },
  };
  const services = {
    groundFloor: {
      cachedGroundFloor: () => null,
      GROUND_FLOOR_LIFT_M: 0,
      neighborFloorM: () => null,
      stickyFloorCell: (latitude, longitude) => ({ latitude, longitude }),
      displayFloorHeightM: () => null,
      coarseFloorCoord: () => ({ lat: 0, lon: 0 }),
      corridorFloorCells: () => [],
      allocateCorridorCells: () => [],
    },
    camera: { trackedModelScaleForPixelCap: () => 1 },
    focus: {
      nearFarScalarValueAtDistance: () => 1,
      clearFocusTarget() {},
      publishFocusTargetFromCachedPosition() {},
    },
  };
  return {
    flightState,
    parts,
    motion: createMotion({ flightState, parts, services }),
  };
}

function cartographic(position) {
  const value = Cesium.Cartographic.fromCartesian(position);
  return {
    latitude: Cesium.Math.toDegrees(value.latitude),
    longitude: Cesium.Math.toDegrees(value.longitude),
    height: value.height,
  };
}

function assertPosition(position, expected) {
  const actual = cartographic(position);
  assert.ok(Math.abs(actual.latitude - expected.latitude) <= 1e-8);
  assert.ok(Math.abs(actual.longitude - expected.longitude) <= 1e-8);
  assert.ok(Math.abs(actual.height - expected.height) <= 1e-4);
}

test('recorded positions follow backward seeks and ignore the live delayed history', () => {
  const { flightState, motion } = motionFixture('recorded');
  const now = 1_800_000_000_000;
  const at = (milliseconds) =>
    Cesium.JulianDate.fromDate(new Date(milliseconds));
  flightState._positionHistory.set('SYNTH-001', [
    {
      time: at(now - 31_000),
      position: Cesium.Cartesian3.fromDegrees(10, 10, 8000),
      velocity: 210,
      track: 90,
    },
    {
      time: at(now - 29_000),
      position: Cesium.Cartesian3.fromDegrees(11, 10, 8000),
      velocity: 210,
      track: 90,
    },
  ]);
  const historyBefore = flightState._positionHistory.get('SYNTH-001');
  const info = {
    positionMode: 'recorded',
    recordingId: 'recording-replay',
    rawLat: 0.25,
    rawLon: 179.72,
    renderAltitudeM: 8123,
    velocity: 210,
    true_track: 90,
  };
  flightState.records.data.set('SYNTH-001', info);
  const output = new Cesium.Cartesian3();
  const selected = motion._deadReckon('SYNTH-001', output, at(0));
  assertPosition(selected, {
    latitude: 0.25,
    longitude: 179.72,
    height: 8123,
  });
  assert.equal(flightState._positionHistory.get('SYNTH-001'), historyBefore);

  info.rawLat = 0;
  info.rawLon = 179.7;
  const backward = motion._deadReckon('SYNTH-001', output, at(1));
  assertPosition(backward, {
    latitude: 0,
    longitude: 179.7,
    height: 8123,
  });
  assert.equal(flightState._positionHistory.get('SYNTH-001'), historyBefore);
});

test('recorded tracked position bypasses continuity correction and same-frame cache can be invalidated', () => {
  const { flightState, motion } = motionFixture('recorded');
  flightState._drReconcileValid = true;
  flightState._drReconcileIcao = 'SYNTH-001';
  flightState._drCorrection = Cesium.Cartesian3.fromDegrees(0.5, 0.5, 0);
  const info = {
    positionMode: 'recorded',
    rawLat: 0.25,
    rawLon: 179.72,
    renderAltitudeM: 8123,
    velocity: 210,
    true_track: 90,
  };
  flightState.records.data.set('SYNTH-001', info);
  const selected = motion._trackedDisplayPosition(
    'SYNTH-001',
    Cesium.JulianDate.fromDate(new Date(0)),
  );
  assertPosition(selected, {
    latitude: 0.25,
    longitude: 179.72,
    height: 8123,
  });
  assert.equal(motion._isTrackWarmingUp(), false);

  info.rawLat = 0;
  info.rawLon = 179.7;
  flightState._cachedDRFrame = -1;
  flightState._drReconcileIcao = null;
  const backward = motion._trackedDisplayPosition(
    'SYNTH-001',
    Cesium.JulianDate.fromDate(new Date(1)),
  );
  assertPosition(backward, {
    latitude: 0,
    longitude: 179.7,
    height: 8123,
  });
});

test('live dead-reckoning retains its delayed-clock interpolation behavior', () => {
  const { flightState, motion } = motionFixture('live');
  const now = 1_800_000_000_000;
  const originalDateNow = Date.now;
  Date.now = () => now;
  try {
    flightState._positionHistory.set('SYNTH-001', [
      {
        time: Cesium.JulianDate.fromDate(new Date(now - 31_000)),
        position: Cesium.Cartesian3.fromDegrees(10, 10, 8000),
        epochMs: now - 31_000,
        velocity: 210,
        track: 90,
      },
      {
        time: Cesium.JulianDate.fromDate(new Date(now - 29_000)),
        position: Cesium.Cartesian3.fromDegrees(11, 10, 8000),
        epochMs: now - 29_000,
        velocity: 210,
        track: 90,
      },
    ]);
    flightState.records.data.set('SYNTH-001', {
      positionMode: 'live',
      rawLat: 50,
      rawLon: 50,
      renderAltitudeM: 8000,
      velocity: 210,
      true_track: 90,
    });
    const live = motion._deadReckon(
      'SYNTH-001',
      undefined,
      Cesium.JulianDate.fromDate(new Date(now - 30_000)),
    );
    const position = cartographic(live);
    assert.ok(Math.abs(position.longitude - 10.5) < 1e-6);
    assert.ok(Math.abs(position.latitude - 10) < 1e-3);
  } finally {
    Date.now = originalDateNow;
  }
});

test('recorded source mode does not call live history warming with no selected sample', () => {
  const { flightState, motion } = motionFixture('recorded');
  flightState._positionHistory.clear();
  assert.equal(motion._isTrackWarmingUp(), true);
});
