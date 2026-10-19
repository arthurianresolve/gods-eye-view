import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
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

test('recorded snapshots invalidate same-frame pose caches, preserve live history, and clear complete gaps', () => {
  let recordedPositionWrites = 0;
  const flightState = {
    _viewer: { camera: { positionCartographic: null }, scene: {} },
    _billboards: new Map(),
    _billboardCollection: {
      add(options) {
        const billboard = { ...options };
        let position = options.position;
        Object.defineProperty(billboard, 'position', {
          enumerable: true,
          get: () => position,
          set: (next) => {
            recordedPositionWrites++;
            position = next;
          },
        });
        return billboard;
      },
      remove(billboard) {
        for (const [id, candidate] of flightState._billboards)
          if (candidate === billboard) flightState._billboards.delete(id);
      },
    },
    _models: new Map(),
    _positionHistory: new Map([
      [
        'SYNTH-001',
        [
          {
            epochMs: 2000,
            time: Cesium.JulianDate.fromDate(new Date(2000)),
            position: Cesium.Cartesian3.fromDegrees(179.72, 0.25, 8123),
            velocity: 210,
            track: 90,
          },
        ],
      ],
      [
        'ORPHAN-LIVE',
        [
          {
            epochMs: 1000,
            time: Cesium.JulianDate.fromDate(new Date(1000)),
            position: Cesium.Cartesian3.fromDegrees(10, 10, 8000),
            velocity: 210,
            track: 90,
          },
        ],
      ],
    ]),
    _cullPositions: new Map(),
    _displayCourse: new Map([
      ['SYNTH-001', 91],
      ['ORPHAN-LIVE', 45],
    ]),
    _groundSnap: { forget() {} },
    _displayFloorState: new Map(),
    _trackedIcao: null,
    _trackedEntity: null,
    _trackedModel: null,
    _cockpitContactMode: false,
    _lastCamPoseSig: '',
    _positionSourceMode: 'live',
    _pruneHistoryAfterReplay: false,
    _cachedDRFrame: 42,
    _cachedDRPosition: { x: 42 },
    _drReconcileValid: true,
    _drReconcileIcao: 'SYNTH-001',
    _trackedFrameTimeFrame: 42,
    _trackedFrameTimeIcao: 'SYNTH-001',
  };
  const liveHistory = flightState._positionHistory.get('SYNTH-001');
  let receivedOptions;
  let trackingCleared = 0;
  let trailCleared = 0;
  let trailStarted = 0;
  let floorProjectionCalls = 0;
  const projectedPosition = Cesium.Cartesian3.fromDegrees(20, 20, 9000);
  const recordData = new Map();
  flightState.records = { data: recordData };
  const records = {
    data: recordData,
    receive(observation, options) {
      receivedOptions = options;
      const meta = {
        rawLon: observation.longitude,
        rawLat: observation.latitude,
        renderAltitudeM: observation.altitudeM,
        positionMode: options.positionMode,
        recordingId: options.recordingId,
        selectedTimeMs: options.selectedTimeMs,
        velocity: observation.velocityMps,
        true_track: observation.headingDeg,
        klass: 'airliner',
        onGround: false,
      };
      recordData.set(observation.id, meta);
      return {
        prevMeta: null,
        meta,
        groundFlipped: false,
        fixEpochMs: observation.positionTimeMs,
      };
    },
    absence() {
      throw new Error('Complete recorded snapshots remove absent IDs directly');
    },
    forget(id) {
      recordData.delete(id);
    },
  };
  const rendering = {
    _releaseModel() {},
    _applyFleetBillboardPresentation() {},
    _syncModelToClass() {},
    _modelOwnsVisual: () => false,
    _iconKind: () => 'airliner',
    _fleetBillboardScale: () => 1,
    _fleetBillboardColor: () => ({ withAlpha: () => ({}) }),
    _normalBillboardScaleByDistance: () => null,
    _groundDepthDistance: () => 0,
  };
  const tracking = {
    _militaryLayerSuppresses: () => false,
    _clearTracking() {
      trackingCleared++;
      flightState._trackedIcao = null;
      flightState._trackedEntity = null;
    },
    _clearTrail() {
      trailCleared++;
    },
    _startTrail(id) {
      assert.equal(id, 'SYNTH-001');
      trailStarted++;
    },
    _appendTrailFix() {},
    _updateTrackedLabelModel() {},
  };
  const applySnapshot = createFlightSnapshotRenderer({
    flightState,
    records,
    militaryRegistry: {
      refreshMilitaryRegistryIfStale() {},
      isMilitaryIcao: () => false,
    },
    groundFloor: { warmGroundFloor() {} },
    meshFloor: { sampleMeshFloorCells() {} },
    rendering,
    tracking,
    motion: {
      _deadReckon: () => Cesium.Cartesian3.fromDegrees(1, 2, 3),
      _floorGroundedDisplayPosition: () => {
        floorProjectionCalls++;
        return projectedPosition;
      },
      _collectDisplayCorridorCells() {},
      _refloorStaleGroundedContacts() {},
    },
    enrichment: { _sweepAmbientEnrichment() {} },
    queries: { _likelyLanded: () => false },
  });

  applySnapshot(
    {
      records: [
        {
          id: 'SYNTH-001',
          latitude: 0.25,
          longitude: 179.72,
          altitudeM: 8123,
          velocityMps: 210,
          headingDeg: 90,
          positionTimeMs: 1000,
        },
        {
          id: 'RECORDED-ONLY',
          latitude: 40,
          longitude: -70,
          altitudeM: 9000,
          velocityMps: 0,
          headingDeg: 0,
          positionTimeMs: 1000,
        },
      ],
      positionMode: 'recorded',
      recordingId: 'recording-a',
      selectedTimeMs: 1000,
      source: 'Local recording · recording-a',
      complete: true,
    },
    flightState._viewer,
  );
  assert.equal(flightState._positionSourceMode, 'recorded');
  assert.equal(receivedOptions.positionMode, 'recorded');
  assert.equal(receivedOptions.recordingId, 'recording-a');
  assert.equal(receivedOptions.selectedTimeMs, 1000);
  assert.equal(flightState._positionHistory.get('SYNTH-001'), liveHistory);
  assert.deepEqual(liveHistory, [
    {
      epochMs: 2000,
      time: Cesium.JulianDate.fromDate(new Date(2000)),
      position: Cesium.Cartesian3.fromDegrees(179.72, 0.25, 8123),
      velocity: 210,
      track: 90,
    },
  ]);
  assert.equal(flightState._cachedDRFrame, -1);
  assert.equal(flightState._cachedDRPosition, null);
  assert.equal(flightState._drReconcileValid, false);
  assert.equal(flightState._trackedFrameTimeFrame, -1);
  assert.equal(trailCleared, 1);
  assert.equal(flightState._pruneHistoryAfterReplay, true);
  assert.equal(floorProjectionCalls, 0);
  assert.ok(
    Cesium.Cartesian3.equals(
      flightState._billboards.get('SYNTH-001').position,
      Cesium.Cartesian3.fromDegrees(179.72, 0.25, 8123),
    ),
  );

  const backwardSeekPosition = Cesium.Cartesian3.fromDegrees(
    179.720001,
    0.25,
    8123,
  );
  applySnapshot(
    {
      records: [
        {
          id: 'SYNTH-001',
          latitude: 0.25,
          longitude: 179.720001,
          altitudeM: 8123,
          velocityMps: 210,
          headingDeg: 90,
          positionTimeMs: 900,
        },
      ],
      positionMode: 'recorded',
      recordingId: 'recording-a',
      selectedTimeMs: 500,
      source: 'Local recording · recording-a',
      complete: true,
    },
    flightState._viewer,
  );
  assert.ok(
    Cesium.Cartesian3.distance(
      flightState._billboards.get('SYNTH-001').position,
      backwardSeekPosition,
    ) < 0.001,
  );
  assert.equal(recordedPositionWrites, 1);
  assert.equal(floorProjectionCalls, 0);

  applySnapshot(
    {
      records: [
        {
          id: 'SYNTH-001',
          latitude: 0.25,
          longitude: 179.72,
          altitudeM: 8123,
          velocityMps: 210,
          headingDeg: 90,
          positionTimeMs: 1000,
        },
      ],
      positionMode: 'recorded',
      recordingId: 'recording-a',
      selectedTimeMs: 1000,
      source: 'Local recording · recording-a',
      complete: true,
    },
    flightState._viewer,
  );
  assert.ok(
    Cesium.Cartesian3.equals(
      flightState._billboards.get('SYNTH-001').position,
      Cesium.Cartesian3.fromDegrees(179.72, 0.25, 8123),
    ),
  );
  assert.equal(recordedPositionWrites, 2);
  applySnapshot(
    {
      records: [
        {
          id: 'SYNTH-001',
          latitude: 0.25,
          longitude: 179.72,
          altitudeM: 8123,
          velocityMps: 210,
          headingDeg: 90,
          positionTimeMs: 1000,
        },
      ],
      positionMode: 'recorded',
      recordingId: 'recording-a',
      selectedTimeMs: 1000,
      source: 'Local recording · recording-a',
      complete: true,
    },
    flightState._viewer,
  );
  assert.equal(recordedPositionWrites, 2);

  flightState._trackedIcao = 'SYNTH-001';
  flightState._trackedEntity = {};
  applySnapshot(
    {
      records: [],
      source: 'Live aircraft feed',
      complete: false,
    },
    flightState._viewer,
  );
  assert.equal(flightState._positionSourceMode, 'live');
  assert.equal(flightState._billboards.has('SYNTH-001'), false);
  assert.equal(flightState._billboards.has('RECORDED-ONLY'), false);
  assert.equal(recordData.has('SYNTH-001'), false);
  assert.equal(recordData.has('RECORDED-ONLY'), false);
  assert.equal(flightState._positionHistory.has('RECORDED-ONLY'), false);
  assert.equal(trackingCleared, 1);
  assert.ok(flightState._positionHistory.has('SYNTH-001'));
  assert.equal(flightState._pruneHistoryAfterReplay, true);

  applySnapshot(
    {
      records: [
        {
          id: 'SYNTH-001',
          latitude: 0.25,
          longitude: 179.72,
          altitudeM: 8123,
          velocityMps: 210,
          headingDeg: 90,
          positionTimeMs: 2500,
        },
      ],
      positionMode: 'recorded',
      recordingId: 'recording-b',
      selectedTimeMs: 2500,
      source: 'Local recording · recording-b',
      complete: true,
    },
    flightState._viewer,
  );
  assert.equal(flightState._positionSourceMode, 'recorded');
  flightState._trackedIcao = 'SYNTH-001';
  flightState._trackedEntity = {};
  applySnapshot(
    {
      records: [],
      positionMode: 'recorded',
      recordingId: 'recording-a',
      selectedTimeMs: 500,
      source: 'Local recording · recording-a',
      complete: true,
    },
    flightState._viewer,
  );
  assert.equal(trackingCleared, 2);
  assert.equal(flightState._billboards.size, 0);
  assert.equal(flightState._positionHistory.get('SYNTH-001'), liveHistory);
  assert.equal(flightState._displayCourse.get('SYNTH-001'), 91);

  flightState._trackedIcao = 'SYNTH-001';
  flightState._trackedEntity = {};
  applySnapshot(
    {
      records: [
        {
          id: 'SYNTH-001',
          latitude: 0.3,
          longitude: 179.73,
          altitudeM: 8123,
          velocityMps: 210,
          headingDeg: 91,
          positionTimeMs: 3000,
        },
      ],
      source: 'Live aircraft feed',
      complete: false,
    },
    flightState._viewer,
  );
  assert.equal(flightState._positionSourceMode, 'live');
  assert.equal(trailStarted, 1);
  assert.equal(floorProjectionCalls, 1);
  assert.equal(flightState._pruneHistoryAfterReplay, true);

  applySnapshot(
    {
      records: [
        {
          id: 'SYNTH-001',
          latitude: 0.31,
          longitude: 179.74,
          altitudeM: 8123,
          velocityMps: 210,
          headingDeg: 91,
          positionTimeMs: 4000,
        },
      ],
      source: 'Live aircraft feed',
      complete: true,
    },
    flightState._viewer,
  );
  assert.equal(flightState._positionHistory.has('ORPHAN-LIVE'), false);
  assert.equal(flightState._displayCourse.has('ORPHAN-LIVE'), false);
  assert.equal(flightState._pruneHistoryAfterReplay, false);
});
