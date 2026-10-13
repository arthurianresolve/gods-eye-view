import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import { FlightRecords } from '../../src/layers/flights/records.js';
import { createFlightSnapshotRenderer } from '../../src/layers/flights/snapshotRenderer.js';
import { MilitaryFlightRecords } from '../../src/layers/military/records.js';
import { createMilitarySnapshotRenderer } from '../../src/layers/military/snapshotRenderer.js';

export const AIRCRAFT_BILLBOARD_AUDIT_SCHEMA =
  'gev-aircraft-billboard-mutation-audit/v1';
const FIXTURE_EPOCH_MS = 1_790_000_000_000;
const FIXTURE_IDS = Object.freeze(['a00001', 'a00002', 'a00003']);
const SOURCE_FILES = Object.freeze([
  'scripts/performance/aircraftBillboardMutationAudit.mjs',
  'src/layers/flights/snapshotRenderer.js',
  'src/layers/flights/records.js',
  'src/layers/flights/recordPolicy.js',
  'src/layers/military/snapshotRenderer.js',
  'src/layers/military/records.js',
  'src/layers/military/recordPolicy.js',
]);
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixtureSnapshot(ids, revision, complete) {
  const indexById = new Map(FIXTURE_IDS.map((id, index) => [id, index]));
  return {
    source: 's53-aircraft-mutation-fixture',
    observedAtMs: FIXTURE_EPOCH_MS + revision * 1000,
    coverage: 'bounded-three-contact-fixture',
    freshness: 'current',
    complete,
    records: ids.map((id) => {
      const index = indexById.get(id);
      if (index === undefined) throw new TypeError('Unknown fixture identity.');
      return {
        id,
        reference: id,
        callsign: `FIX${index + 1}`,
        latitude: 30.2 + index * 0.01 + revision * 0.0001,
        longitude: -97.7 + index * 0.01 + revision * 0.0001,
        baroAltitudeM: 9000 + index * 100,
        ellipsoidAltitudeM: 9200 + index * 100,
        onGround: false,
        speedMps: 150 + index,
        courseDeg: 80 + index,
        verticalRateMps: 0,
        positionTimeMs: FIXTURE_EPOCH_MS + revision * 1000,
        contactTimeMs: FIXTURE_EPOCH_MS + revision * 1000,
        category: 3,
        typeCode: 'A320',
      };
    }),
  };
}

function createCountingCollection() {
  const collection = new Cesium.BillboardCollection();
  const rawForProxy = new WeakMap();
  const tokenByBillboard = new WeakMap();
  const writes = { position: 0, color: 0 };
  const counts = { adds: 0, removes: 0 };
  let nextToken = 1;
  return {
    counts,
    writes,
    get length() {
      return collection.length;
    },
    add(options) {
      counts.adds += 1;
      const billboard = collection.add(options);
      tokenByBillboard.set(billboard, nextToken++);
      const proxy = new Proxy(billboard, {
        set(target, property, value) {
          if (property === 'position' || property === 'color')
            writes[property] += 1;
          return Reflect.set(target, property, value, target);
        },
      });
      rawForProxy.set(proxy, billboard);
      return proxy;
    },
    remove(billboard) {
      const beforeLength = collection.length;
      collection.remove(rawForProxy.get(billboard) || billboard);
      const removed = collection.length < beforeLength;
      if (removed) counts.removes += 1;
      return removed;
    },
    identityEntries(map) {
      return [...map.entries()]
        .map(([id, billboard]) => [
          id,
          tokenByBillboard.get(rawForProxy.get(billboard)),
        ])
        .sort(([left], [right]) => left.localeCompare(right));
    },
    destroy() {
      const lengthBeforeDestroy = collection.length;
      if (lengthBeforeDestroy > 0) collection.removeAll();
      if (!collection.isDestroyed()) collection.destroy();
      return {
        lengthBeforeDestroy,
        lengthAfterRemoval: collection.length,
        destroyed: collection.isDestroyed(),
        prototypeInstrumentationInstalled: false,
      };
    },
  };
}

function createRenderer(kind) {
  const counted = createCountingCollection();
  const state = {
    _viewer: { camera: { positionCartographic: null }, scene: {} },
    _billboards: new Map(),
    _billboardCollection: counted,
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
  const records =
    kind === 'flights'
      ? new FlightRecords({
          geoidHeight: () => 0,
          cachedGroundFloor: () => null,
          floorAltitudeM: (height) => height,
        })
      : new MilitaryFlightRecords({
          geoidHeight: () => 0,
          cachedGroundFloor: () => null,
          floorAltitudeM: (height) => height,
        });
  state.records = records;
  const rendering = {
    _releaseModel() {},
    _applyFleetBillboardPresentation() {},
    _modelOwnsVisual: () => false,
    _syncModelToClass() {},
    _iconKind: () => 'airliner',
    _fleetBillboardScale: () => 1,
    _fleetBillboardColor: () => Cesium.Color.WHITE,
    _normalBillboardScaleByDistance: () => null,
    _groundDepthDistance: () => 0,
  };
  const groundFloor = {
    warmGroundFloor() {},
    cachedGroundFloor: () => null,
    GROUND_FLOOR_LIFT_M: 1.5,
  };
  const meshFloor = { sampleMeshFloorCells() {} };
  const tracking = {
    _militaryLayerSuppresses: () => false,
    _appendTrailFix() {},
    _startTrail() {},
    _updateTrackedLabelModel() {},
    _clearTracking() {},
  };
  const motion = {
    _deadReckon: () => null,
    _floorGroundedDisplayPosition: () => null,
    _collectDisplayCorridorCells() {},
    _refloorStaleGroundedContacts() {},
  };
  const registry = {
    refreshMilitaryRegistryIfStale() {},
    isMilitaryIcao: () => false,
    registerMilitaryIcaos() {},
  };
  const queries = { _likelyLanded: () => false };
  const applySnapshot =
    kind === 'flights'
      ? createFlightSnapshotRenderer({
          flightState: state,
          records,
          militaryRegistry: registry,
          groundFloor,
          meshFloor,
          rendering,
          tracking,
          motion,
          enrichment: { _sweepAmbientEnrichment() {} },
          queries,
        })
      : createMilitarySnapshotRenderer({
          flightState: state,
          records,
          groundFloor,
          meshFloor,
          militaryRegistry: registry,
          rendering,
          tracking,
          motion,
          queries,
        });
  return { state, records, applySnapshot, counted };
}

function snapshotStage(context, label, snapshot) {
  const before = { ...context.counted.counts };
  const writesBefore = { ...context.counted.writes };
  const applyResult = context.applySnapshot(snapshot, context.state._viewer);
  const identities = context.counted.identityEntries(context.state._billboards);
  return {
    label,
    inputRecordCount: snapshot.records.length,
    complete: snapshot.complete,
    returnedCount: applyResult.count,
    retainedCount: context.state._billboards.size,
    collectionLength: context.counted.length,
    added: context.counted.counts.adds - before.adds,
    removed: context.counted.counts.removes - before.removes,
    attemptedPositionWrites:
      context.counted.writes.position - writesBefore.position,
    attemptedColorWrites: context.counted.writes.color - writesBefore.color,
    identityEntries: identities,
    identitySha256: sha256(Buffer.from(JSON.stringify(identities))),
  };
}

function sourceDigests() {
  return Object.fromEntries(
    SOURCE_FILES.map((sourcePath) => [
      sourcePath,
      sha256(readFileSync(path.join(ROOT, sourcePath))),
    ]),
  );
}

function runLayer(kind) {
  const context = createRenderer(kind);
  const stages = [];
  let churnControl;
  let cleanup;
  try {
    stages.push(
      snapshotStage(
        context,
        'initial-population',
        fixtureSnapshot(FIXTURE_IDS, 0, true),
      ),
    );
    stages.push(
      snapshotStage(
        context,
        'equivalent-repeat',
        fixtureSnapshot(FIXTURE_IDS, 0, true),
      ),
    );
    stages.push(
      snapshotStage(
        context,
        'changed-positions-same-identities',
        fixtureSnapshot(FIXTURE_IDS, 1, true),
      ),
    );
    stages.push(
      snapshotStage(
        context,
        'partial-absence-retained',
        fixtureSnapshot(FIXTURE_IDS.slice(0, 2), 2, false),
      ),
    );
    stages.push(
      snapshotStage(context, 'complete-miss-1', fixtureSnapshot([], 3, true)),
    );
    stages.push(
      snapshotStage(context, 'complete-miss-2', fixtureSnapshot([], 4, true)),
    );
    stages.push(
      snapshotStage(
        context,
        'complete-miss-3-removal',
        fixtureSnapshot([], 5, true),
      ),
    );
    stages.push(
      snapshotStage(
        context,
        'reappearance',
        fixtureSnapshot([FIXTURE_IDS[0]], 6, true),
      ),
    );

    const churn = createRenderer(kind);
    let churnCleanup;
    try {
      const churnInitial = snapshotStage(
        churn,
        'churn-control-initial',
        fixtureSnapshot(FIXTURE_IDS, 0, true),
      );
      const removalsBeforeChurn = churn.counted.counts.removes;
      for (const billboard of churn.state._billboards.values())
        churn.state._billboardCollection.remove(billboard);
      churn.state._billboards.clear();
      const removedBeforeRepeat =
        churn.counted.counts.removes - removalsBeforeChurn;
      const churnRepeat = snapshotStage(
        churn,
        'churn-control-repeat',
        fixtureSnapshot(FIXTURE_IDS, 0, true),
      );
      const detected =
        churnRepeat.added === FIXTURE_IDS.length &&
        removedBeforeRepeat === FIXTURE_IDS.length &&
        churnRepeat.identitySha256 !== churnInitial.identitySha256;
      churnControl = {
        ...churnRepeat,
        removedBeforeRepeat,
        previousIdentitySha256: churnInitial.identitySha256,
        detected,
      };
    } finally {
      churnCleanup = churn.counted.destroy();
    }
    churnControl.cleanup = churnCleanup;
  } finally {
    cleanup = context.counted.destroy();
  }
  return { kind, stages, churnControl, cleanup };
}

/** Run a bounded current-path snapshot/record audit without a WebGL context. */
export function createAircraftBillboardMutationAudit() {
  const fixture = FIXTURE_IDS.map((id, index) => ({
    id,
    latitude: 30.2 + index * 0.01,
    longitude: -97.7 + index * 0.01,
    positionTimeMs: FIXTURE_EPOCH_MS,
  }));
  return {
    schema: AIRCRAFT_BILLBOARD_AUDIT_SCHEMA,
    cesiumVersion: Cesium.VERSION,
    scope:
      'snapshot-and-record-producers-with-real-billboard-collections-no-webgl',
    fixture: {
      recordCount: fixture.length,
      sha256: sha256(Buffer.from(JSON.stringify(fixture))),
    },
    sourceSha256: sourceDigests(),
    runs: [runLayer('flights'), runLayer('military')],
    limitations: [
      'No WebGL context, GPU upload count, upload bytes, or frame-time claim.',
      'Rendering-tick position/focus/freshness writes are outside this snapshot-path audit.',
      'Churn control is a deliberate map-ownership mutation for audit sensitivity, not a proposed implementation.',
      'Absolute current behavior only; no aircraft before/after optimization is measured.',
    ],
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.stdout.write(
    `${JSON.stringify(createAircraftBillboardMutationAudit(), null, 2)}\n`,
  );
