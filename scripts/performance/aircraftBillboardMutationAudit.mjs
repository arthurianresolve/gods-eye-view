import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
const FIXED_RECEIPT_CLOCK_MS = 1_790_000_123_456;
const FIXTURE_CONTACTS = Object.freeze([
  { id: 'a00001', latitude: 30.2, longitude: -97.7, index: 0 },
  { id: 'a00002', latitude: 30.21, longitude: -97.69, index: 1 },
  { id: 'a00003', latitude: 30.22, longitude: -97.68, index: 2 },
]);
const DEFAULT_STAGE_ORDER = Object.freeze([
  'initial-population',
  'equivalent-repeat',
  'changed-positions-same-identities',
  'partial-absence-retained',
  'complete-miss-1',
  'complete-miss-2',
  'complete-miss-3-removal',
  'reappearance',
]);
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
const PACKAGE_LOCK_PATH = 'package-lock.json';
const INSTALLED_CESIUM_PACKAGE_PATH = 'node_modules/cesium/package.json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function makeFixtureStage(label, ids, revision, complete, contacts) {
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const observedAtMs = FIXTURE_EPOCH_MS + revision * 1000;
  return {
    label,
    revision,
    snapshot: {
      source: 's53-aircraft-mutation-fixture',
      observedAtMs,
      coverage: 'bounded-three-contact-fixture',
      freshness: 'current',
      complete,
      records: ids.map((id) => {
        const contact = byId.get(id);
        if (!contact) throw new TypeError('Unknown fixture identity.');
        const { index } = contact;
        return {
          id,
          reference: id,
          callsign: `FIX${index + 1}`,
          latitude: contact.latitude + revision * 0.0001,
          longitude: contact.longitude + revision * 0.0001,
          baroAltitudeM: contact.baroAltitudeM,
          ellipsoidAltitudeM: contact.ellipsoidAltitudeM,
          onGround: contact.onGround,
          speedMps: contact.speedMps,
          courseDeg: contact.courseDeg,
          verticalRateMps: contact.verticalRateMps,
          positionTimeMs: observedAtMs,
          contactTimeMs: observedAtMs,
          category: contact.category,
          typeCode: contact.typeCode,
        };
      }),
    },
  };
}

export function createAircraftBillboardFixtureDescriptor({
  altitudeOffsetM = 0,
  receiptClockMs = FIXED_RECEIPT_CLOCK_MS,
  stageOrder = DEFAULT_STAGE_ORDER,
  completeOverrides = {},
} = {}) {
  if (!Number.isSafeInteger(receiptClockMs) || receiptClockMs < 0)
    throw new TypeError('Fixture receipt clock must be a nonnegative integer.');
  if (!Number.isFinite(altitudeOffsetM))
    throw new TypeError('Fixture altitude offset must be finite.');
  const contacts = FIXTURE_CONTACTS.map((contact) => ({
    ...contact,
    baroAltitudeM: 9000 + contact.index * 100 + altitudeOffsetM,
    ellipsoidAltitudeM: 9200 + contact.index * 100 + altitudeOffsetM,
    onGround: false,
    speedMps: 150 + contact.index,
    courseDeg: 80 + contact.index,
    verticalRateMps: 0,
    category: 3,
    typeCode: 'A320',
  }));
  const definitions = new Map([
    [
      'initial-population',
      { ids: ['a00001', 'a00002', 'a00003'], revision: 0, complete: true },
    ],
    [
      'equivalent-repeat',
      { ids: ['a00001', 'a00002', 'a00003'], revision: 0, complete: true },
    ],
    [
      'changed-positions-same-identities',
      { ids: ['a00001', 'a00002', 'a00003'], revision: 1, complete: true },
    ],
    [
      'partial-absence-retained',
      { ids: ['a00001', 'a00002'], revision: 2, complete: false },
    ],
    ['complete-miss-1', { ids: [], revision: 3, complete: true }],
    ['complete-miss-2', { ids: [], revision: 4, complete: true }],
    ['complete-miss-3-removal', { ids: [], revision: 5, complete: true }],
    ['reappearance', { ids: ['a00001'], revision: 6, complete: true }],
  ]);
  const stages = stageOrder.map((label) => {
    const definition = definitions.get(label);
    if (!definition) throw new TypeError('Fixture stage order is unsupported.');
    const { ids, revision } = definition;
    let { complete } = definition;
    if (Object.hasOwn(completeOverrides, label))
      complete = completeOverrides[label];
    if (typeof complete !== 'boolean')
      throw new TypeError('Fixture snapshot completeness must be boolean.');
    return makeFixtureStage(label, ids, revision, complete, contacts);
  });
  if (
    stages.length !== definitions.size ||
    new Set(stageOrder).size !== definitions.size
  )
    throw new TypeError('Fixture stage order must include every stage once.');
  return {
    schema: 'gev-aircraft-billboard-fixture/v1',
    receiptClockMs,
    source: 's53-aircraft-mutation-fixture',
    coverage: 'bounded-three-contact-fixture',
    contacts,
    stages,
    collaboratorAssumptions: {
      viewer: { cameraCartographic: null, sceneAvailable: true },
      records: {
        geoidReady: false,
        geoidHeightM: 0,
        cachedGroundFloorM: null,
        floorAltitude: 'identity',
        incompleteRecentSnapshot: 'retain',
        completeMissesBeforeRemoval: 3,
      },
      rendering: {
        modelOwnsVisual: false,
        presentationCallbacks: 'no-op',
        fixtureBillboardColor: [1, 1, 1, 1],
      },
      motion: { deadReckonedPosition: null, trackedId: null },
      registry: { militaryClassification: false, suppression: false },
      collection: { engine: 'Cesium.BillboardCollection', webglContext: false },
    },
    churnControl: {
      initialStage: 'initial-population',
      repeatStage: 'equivalent-repeat',
      operation: 'remove-all-owned-billboards-and-clear-id-map-before-repeat',
    },
  };
}

export function aircraftBillboardFixtureSha256(descriptor) {
  return sha256(Buffer.from(JSON.stringify(descriptor)));
}

export function withDeterministicAuditReceiptClock(clockMs, operation) {
  if (!Number.isSafeInteger(clockMs) || clockMs < 0)
    throw new TypeError('Audit receipt clock must be a nonnegative integer.');
  if (typeof operation !== 'function')
    throw new TypeError('Audit clock operation must be a function.');
  const originalNow = Date.now;
  Date.now = () => clockMs;
  try {
    return operation();
  } finally {
    Date.now = originalNow;
  }
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
    observedRecordReceiptTimesMs: [...context.records.data.values()]
      .map(({ observedReceiptMs }) => observedReceiptMs)
      .sort((left, right) => left - right),
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

function sourceIdentity() {
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  const status = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return {
    gitHead,
    workingTreeClean: status.length === 0,
    statusSha256: sha256(Buffer.from(status)),
  };
}

function runLayer(kind, fixtureDescriptor) {
  const context = createRenderer(kind);
  const stages = [];
  let churnControl;
  let cleanup;
  try {
    for (const stage of fixtureDescriptor.stages)
      stages.push(snapshotStage(context, stage.label, stage.snapshot));

    const churn = createRenderer(kind);
    let churnCleanup;
    try {
      const initialStage = fixtureDescriptor.stages.find(
        ({ label }) => label === fixtureDescriptor.churnControl.initialStage,
      );
      const repeatStage = fixtureDescriptor.stages.find(
        ({ label }) => label === fixtureDescriptor.churnControl.repeatStage,
      );
      if (!initialStage || !repeatStage)
        throw new TypeError('Fixture churn-control stages are missing.');
      const churnInitial = snapshotStage(
        churn,
        `churn-control-${initialStage.label}`,
        initialStage.snapshot,
      );
      const removalsBeforeChurn = churn.counted.counts.removes;
      for (const billboard of churn.state._billboards.values())
        churn.state._billboardCollection.remove(billboard);
      churn.state._billboards.clear();
      const removedBeforeRepeat =
        churn.counted.counts.removes - removalsBeforeChurn;
      const churnRepeat = snapshotStage(
        churn,
        `churn-control-${repeatStage.label}`,
        repeatStage.snapshot,
      );
      const expectedCount = initialStage.snapshot.records.length;
      const detected =
        churnRepeat.added === expectedCount &&
        removedBeforeRepeat === expectedCount &&
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
export function createAircraftBillboardMutationAudit({
  fixtureDescriptor = createAircraftBillboardFixtureDescriptor(),
} = {}) {
  const originalNow = Date.now;
  const report = withDeterministicAuditReceiptClock(
    fixtureDescriptor.receiptClockMs,
    () => {
      const installedCesiumPackage = JSON.parse(
        readFileSync(path.join(ROOT, INSTALLED_CESIUM_PACKAGE_PATH), 'utf8'),
      );
      if (installedCesiumPackage.version !== Cesium.VERSION)
        throw new Error('Installed Cesium package and API versions disagree.');
      return {
        schema: AIRCRAFT_BILLBOARD_AUDIT_SCHEMA,
        cesiumVersion: Cesium.VERSION,
        scope:
          'snapshot-and-record-producers-with-real-billboard-collections-no-webgl',
        fixture: {
          descriptor: fixtureDescriptor,
          recordCount: fixtureDescriptor.contacts.length,
          sha256: aircraftBillboardFixtureSha256(fixtureDescriptor),
        },
        sourceIdentity: sourceIdentity(),
        lockfileSha256: sha256(
          readFileSync(path.join(ROOT, PACKAGE_LOCK_PATH)),
        ),
        installedCesiumPackageSha256: sha256(
          readFileSync(path.join(ROOT, INSTALLED_CESIUM_PACKAGE_PATH)),
        ),
        sourceSha256: sourceDigests(),
        runs: [
          runLayer('flights', fixtureDescriptor),
          runLayer('military', fixtureDescriptor),
        ],
        limitations: [
          'No WebGL context, GPU upload count, upload bytes, or frame-time claim.',
          'Rendering-tick position/focus/freshness writes are outside this snapshot-path audit.',
          'Churn control is a deliberate map-ownership mutation for audit sensitivity, not a proposed implementation.',
          'Absolute current behavior only; no aircraft before/after optimization is measured.',
        ],
      };
    },
  );
  return {
    ...report,
    clock: {
      receiptClockMs: fixtureDescriptor.receiptClockMs,
      restoredAfterRun: Date.now === originalNow,
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.stdout.write(
    `${JSON.stringify(createAircraftBillboardMutationAudit(), null, 2)}\n`,
  );
