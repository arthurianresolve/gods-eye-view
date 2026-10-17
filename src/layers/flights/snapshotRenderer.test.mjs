import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlightSnapshotRenderer } from './snapshotRenderer.js';

test('repeated fixed-time OpenSky observations do not grow flight history, while a fresh epoch does', () => {
  const flightState = {
    _viewer: { camera: { positionCartographic: null }, scene: {} },
    _billboards: new Map(),
    _billboardCollection: {
      add: (options) => ({ ...options }),
      remove() {},
    },
    _models: new Map(),
    _positionHistory: new Map(),
    _cullPositions: new Map(),
    _displayCourse: new Map(),
    _groundSnap: { forget() {} },
    _displayFloorState: new Map(),
    _trackedIcao: null,
    _trackedEntity: null,
    _trackedModel: null,
    _cockpitContactMode: false,
    _lastCamPoseSig: '',
  };
  let epochMs = 1_791_462_000_000;
  const record = {
    receive: () => ({
      prevMeta: { klass: 'airliner' },
      meta: {
        rawLon: -97.7,
        rawLat: 30.2,
        renderAltitudeM: 10_000,
        velocity: 120,
        true_track: 90,
        klass: 'airliner',
        onGround: false,
      },
      groundFlipped: false,
      fixEpochMs: epochMs,
    }),
    absence: () => 'remove',
    forget() {},
  };
  const rendering = {
    _releaseModel() {},
    _applyFleetBillboardPresentation() {},
    _modelOwnsVisual: () => false,
    _iconKind: () => 'airliner',
    _fleetBillboardScale: () => 1,
    _fleetBillboardColor: () => ({ withAlpha: () => ({}) }),
    _normalBillboardScaleByDistance: () => null,
    _groundDepthDistance: () => 0,
  };
  const applySnapshot = createFlightSnapshotRenderer({
    flightState,
    records: record,
    militaryRegistry: {
      refreshMilitaryRegistryIfStale() {},
      isMilitaryIcao: () => false,
    },
    groundFloor: { warmGroundFloor() {} },
    meshFloor: { sampleMeshFloorCells() {} },
    rendering,
    tracking: { _militaryLayerSuppresses: () => false },
    motion: {
      _deadReckon: () => null,
      _floorGroundedDisplayPosition: () => null,
      _collectDisplayCorridorCells() {},
      _refloorStaleGroundedContacts() {},
    },
    enrichment: { _sweepAmbientEnrichment() {} },
    queries: { _likelyLanded: () => false },
  });
  const snapshot = {
    records: [
      {
        id: '000001',
        latitude: 30.2,
        longitude: -97.7,
        positionTimeMs: epochMs,
      },
    ],
    source: 'OpenSky',
    observedAtMs: epochMs,
    coverage: 'fixture',
    freshness: 'current',
    complete: true,
  };

  applySnapshot(snapshot, flightState._viewer);
  applySnapshot(snapshot, flightState._viewer);
  assert.equal(flightState._positionHistory.get('000001').length, 1);

  epochMs += 1_000;
  snapshot.observedAtMs = epochMs;
  snapshot.records[0].positionTimeMs = epochMs;
  applySnapshot(snapshot, flightState._viewer);
  assert.equal(flightState._positionHistory.get('000001').length, 2);
  assert.deepEqual(
    flightState._positionHistory.get('000001').map((fix) => fix.epochMs),
    [1_791_462_000_000, 1_791_462_001_000],
  );

  epochMs -= 500;
  snapshot.observedAtMs = epochMs;
  snapshot.records[0].positionTimeMs = epochMs;
  applySnapshot(snapshot, flightState._viewer);
  assert.deepEqual(
    flightState._positionHistory.get('000001').map((fix) => fix.epochMs),
    [1_791_462_000_000, 1_791_462_001_000],
    'an older observation cannot rewind or extend position history',
  );
});
