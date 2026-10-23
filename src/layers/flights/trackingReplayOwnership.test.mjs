import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createTracking } from './tracking.js';

function trackingFixture({ positionMode = 'live', getTrack } = {}) {
  const flightState = {
    _positionSourceMode: positionMode,
    _trailBackfillToken: 4,
    _trailPositions: [new Cesium.Cartesian3(1, 2, 3)],
    _trail: {
      clearCount: 0,
      clear() {
        this.clearCount++;
      },
    },
    _trailHeadEntity: null,
    _trailHeadSeq: 0,
    _cockpitContactMode: false,
    _viewer: null,
    _positionHistory: new Map(),
    _trackedIcao: 'SYNTH-001',
    _records: null,
    records: { data: new Map() },
    feed: { _source: { getTrack } },
    lifetime: { signal: new AbortController().signal },
    _scratchWarmupTime: new Cesium.JulianDate(),
  };
  const services = {
    context: {
      selectTrackedSubjectContext() {},
      clearTrackedSubjectContext() {},
      refreshTrackedSubjectContext() {},
    },
    aircraftPresentation: {
      isTr3b: () => false,
      tr3bTypeLabel: () => '',
      tr3bConvertedIds: new Set(),
    },
    trails: { createTrail: () => flightState._trail },
    geoid: { ensureGeoidReady: async () => {}, geoidHeight: () => 0 },
    groundFloor: {
      resolveGroundFloorCellsBounded: async () => {},
      floorAltitudeM: () => 1000,
      cachedGroundFloor: () => 0,
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
  const parts = {
    lifecycle: {},
    motion: {},
    queries: {},
    rendering: {},
  };
  return {
    flightState,
    tracking: createTracking({
      flightState,
      services,
      parts,
      layer: {},
      resolveAsset() {},
    }),
  };
}

test('recorded tracking clears live trail and does not seed or request live backfill', () => {
  let trackRequests = 0;
  const { flightState, tracking } = trackingFixture({
    positionMode: 'recorded',
    getTrack: async () => {
      trackRequests++;
      return { records: [] };
    },
  });

  tracking._startTrail('SYNTH-001');

  assert.equal(flightState._trailPositions.length, 0);
  assert.equal(flightState._trail.clearCount, 1);
  assert.equal(trackRequests, 0);
});

test('live backfill resolving after trail cleanup cannot restore a stale trail', async () => {
  let resolveTrack;
  const pendingTrack = new Promise((resolve) => {
    resolveTrack = resolve;
  });
  const { flightState, tracking } = trackingFixture({
    getTrack: () => pendingTrack,
  });

  const backfill = tracking._backfillTrail(
    'SYNTH-001',
    flightState._trailBackfillToken,
    Number.POSITIVE_INFINITY,
  );
  tracking._clearTrail();
  resolveTrack({
    records: [
      {
        observedAtMs: 1_700_000_000_000,
        latitude: 40,
        longitude: -70,
        baroAltitudeM: 9000,
      },
    ],
  });
  await backfill;

  assert.deepEqual(flightState._trailPositions, []);
  assert.equal(flightState._trail.clearCount, 1);
});
