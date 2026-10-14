import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import { createRendering as createFlightRendering } from '../../src/layers/flights/rendering.js';
import { createRendering as createMilitaryRendering } from '../../src/layers/military/rendering.js';
import { FlightRecords } from '../../src/layers/flights/records.js';
import { MilitaryFlightRecords } from '../../src/layers/military/records.js';
import {
  applyAircraftBillboardTreatment,
  applyAircraftModelTreatment,
} from '../../src/data/aircraftRecession.js';
import { nearFarScalarValueAtDistance } from '../../src/data/focusDeemphasis.js';
import { FLEET_DR_INTERVAL_MS } from '../../src/layers/flights/policy.js';
import { FLEET_DR_INTERVAL_MS as MILITARY_FLEET_DR_INTERVAL_MS } from '../../src/layers/military/policy.js';

export const AIRCRAFT_FLEET_TICK_AUDIT_SCHEMA =
  'gev-aircraft-fleet-tick-audit/v1';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const FIXTURE_EPOCH_MS = 1_790_000_000_000;
const CAMERA = Object.freeze({
  longitude: -97.7,
  latitude: 30.2,
  heightM: 20_000,
});
const REQUIRED_CONTACTS = Object.freeze([
  'stationary',
  'moving',
  'selected',
  'suppressed',
  'horizon-hidden',
  'fading',
  'model-handoff',
]);
const SOURCE_FILES = Object.freeze([
  'scripts/performance/aircraftFleetTickAudit.mjs',
  'scripts/performance/aircraftFleetTickAudit.test.mjs',
  'src/layers/flights/rendering.js',
  'src/layers/military/rendering.js',
  'src/layers/flights/records.js',
  'src/layers/military/records.js',
  'src/layers/flights/policy.js',
  'src/layers/military/policy.js',
  'src/data/aircraftRecession.js',
  'src/data/iconOrientation.js',
]);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

if (FLEET_DR_INTERVAL_MS !== MILITARY_FLEET_DR_INTERVAL_MS)
  throw new Error('Flight and military fleet tick cadences diverged.');

export function createAircraftFleetTickFixtureDescriptor({
  receiptClockMs = FIXTURE_EPOCH_MS + 123_456,
  altitudeOffsetM = 0,
  stageOrder = REQUIRED_CONTACTS,
  complete = true,
} = {}) {
  if (!Number.isSafeInteger(receiptClockMs) || receiptClockMs < 0)
    throw new TypeError('Fixture receipt clock must be a nonnegative integer.');
  if (!Number.isFinite(altitudeOffsetM))
    throw new TypeError('Fixture altitude offset must be finite.');
  if (
    !Array.isArray(stageOrder) ||
    stageOrder.length !== REQUIRED_CONTACTS.length ||
    new Set(stageOrder).size !== REQUIRED_CONTACTS.length ||
    stageOrder.some((name) => !REQUIRED_CONTACTS.includes(name))
  )
    throw new TypeError('Fleet fixture order must include every contact once.');
  if (typeof complete !== 'boolean')
    throw new TypeError('Fixture completeness must be boolean.');

  const contacts = [
    {
      id: 'a10001',
      role: 'stationary',
      latitude: CAMERA.latitude,
      longitude: CAMERA.longitude,
      altitudeM: 10_000 + altitudeOffsetM,
      motionOffset: [0, 0, 0],
      tracked: false,
      billboard: true,
      focusFactor: 1,
      missingPolls: 0,
      model: { present: true, ready: false, show: false },
    },
    {
      id: 'a10002',
      role: 'moving',
      latitude: CAMERA.latitude + 0.0001,
      longitude: CAMERA.longitude,
      altitudeM: 10_000 + altitudeOffsetM,
      motionOffset: [40, 0, 0],
      tracked: false,
      billboard: true,
      focusFactor: 1,
      missingPolls: 0,
      model: { present: true, ready: false, show: false },
    },
    {
      id: 'a10003',
      role: 'selected',
      latitude: CAMERA.latitude - 0.0001,
      longitude: CAMERA.longitude,
      altitudeM: 10_000 + altitudeOffsetM,
      motionOffset: [80, 0, 0],
      tracked: true,
      billboard: true,
      focusFactor: 1,
      missingPolls: 0,
      model: { present: false, ready: false, show: false },
    },
    {
      id: 'a10004',
      role: 'suppressed',
      latitude: CAMERA.latitude + 0.0002,
      longitude: CAMERA.longitude,
      altitudeM: 10_000 + altitudeOffsetM,
      motionOffset: [0, 0, 0],
      tracked: false,
      billboard: false,
      focusFactor: 1,
      missingPolls: 0,
      model: { present: false, ready: false, show: false },
    },
    {
      id: 'a10005',
      role: 'horizon-hidden',
      latitude: -CAMERA.latitude,
      longitude: CAMERA.longitude + 180,
      altitudeM: 10_000 + altitudeOffsetM,
      motionOffset: [0, 0, 0],
      tracked: false,
      billboard: true,
      focusFactor: 1,
      missingPolls: 0,
      model: { present: false, ready: false, show: false },
    },
    {
      id: 'a10006',
      role: 'fading',
      latitude: CAMERA.latitude,
      longitude: CAMERA.longitude + 0.0002,
      altitudeM: 10_000 + altitudeOffsetM,
      motionOffset: [0, 0, 0],
      tracked: false,
      billboard: true,
      focusFactor: 0.4,
      missingPolls: 0,
      model: { present: true, ready: false, show: false },
    },
    {
      id: 'a10007',
      role: 'model-handoff',
      latitude: CAMERA.latitude,
      longitude: CAMERA.longitude - 0.0002,
      altitudeM: 10_000 + altitudeOffsetM,
      motionOffset: [0, 0, 0],
      tracked: false,
      billboard: true,
      focusFactor: 1,
      missingPolls: 0,
      model: { present: true, ready: true, show: false },
    },
  ].map((contact) => ({ ...contact, snapshotComplete: complete }));
  const contactsByRole = new Map(
    contacts.map((contact) => [contact.role, contact]),
  );
  const orderedContacts = stageOrder.map((role) => contactsByRole.get(role));

  return {
    schema: 'gev-aircraft-fleet-tick-fixture/v1',
    receiptClockMs,
    camera: { ...CAMERA },
    stageOrder: [...stageOrder],
    contacts: orderedContacts,
    cadenceMs: FLEET_DR_INTERVAL_MS,
    militaryCadenceMs: MILITARY_FLEET_DR_INTERVAL_MS,
    collaboratorAssumptions: {
      deadReckoning: 'fixed-per-contact-cartesian-offset-into-provided-scratch',
      focus: 'fixed-factor-by-contact-role',
      groundFloor: 'airborne-fixture-returns-input-position',
      modelLoader: 'preloaded-in-memory-objects-only-no-asset-io',
      registry: 'no-military-classification-or-civil-suppression',
      camera: 'Cesium.Camera-1.138-real-frustum-and-ellipsoid-horizon',
      collection: 'real-Cesium.BillboardCollection-no-WebGL-context',
      snapshotCompleteness: complete,
    },
    churnControl: {
      operation: 'remove-owned-billboard-clear-id-entry-readd-same-contact',
      role: 'stationary',
    },
  };
}

export function aircraftFleetTickFixtureSha256(fixture) {
  return sha256(Buffer.from(JSON.stringify(fixture)));
}

function withClock(clockMs, operation) {
  const originalNow = Date.now;
  Date.now = () => clockMs;
  try {
    return operation();
  } finally {
    Date.now = originalNow;
  }
}

function sceneAndCamera(cameraDescriptor) {
  const scene = {
    drawingBufferWidth: 1280,
    drawingBufferHeight: 800,
    ellipsoid: Cesium.Ellipsoid.WGS84,
    mapProjection: new Cesium.GeographicProjection(Cesium.Ellipsoid.WGS84),
    mode: Cesium.SceneMode.SCENE3D,
  };
  const camera = new Cesium.Camera(scene);
  camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      cameraDescriptor.longitude,
      cameraDescriptor.latitude,
      cameraDescriptor.heightM,
    ),
    orientation: {
      heading: 0,
      pitch: -Cesium.Math.PI_OVER_TWO,
      roll: 0,
    },
  });
  scene.camera = camera;
  return { scene, camera };
}

function countedBillboardCollection() {
  const collection = new Cesium.BillboardCollection();
  const proxyToBillboard = new WeakMap();
  const tokenByBillboard = new WeakMap();
  const totals = { adds: 0, removes: 0 };
  const attemptedWrites = new Map();
  let nextToken = 1;
  const trackedProperties = [
    'position',
    'color',
    'scale',
    'show',
    'rotation',
    'image',
  ];

  function add(options) {
    totals.adds += 1;
    const billboard = collection.add(options);
    tokenByBillboard.set(billboard, nextToken++);
    const counts = Object.fromEntries(
      trackedProperties.map((name) => [name, 0]),
    );
    const proxy = new Proxy(billboard, {
      set(target, property, value) {
        if (Object.hasOwn(counts, property)) counts[property] += 1;
        return Reflect.set(target, property, value, target);
      },
    });
    proxyToBillboard.set(proxy, billboard);
    attemptedWrites.set(proxy, counts);
    return proxy;
  }

  function identity(map) {
    return [...map.entries()]
      .map(([id, billboard]) => [
        id,
        tokenByBillboard.get(proxyToBillboard.get(billboard)),
      ])
      .sort(([left], [right]) => left.localeCompare(right));
  }

  return {
    collection,
    totals,
    attemptedWrites,
    add,
    identity,
    remove(map, id) {
      const billboard = map.get(id);
      if (!billboard) return false;
      const removed = collection.remove(proxyToBillboard.get(billboard));
      if (removed) totals.removes += 1;
      map.delete(id);
      return removed;
    },
    destroy() {
      const removed = collection.length;
      collection.removeAll();
      if (!collection.isDestroyed()) collection.destroy();
      return {
        removedAtCleanup: removed,
        lengthAfterCleanup: collection.length,
        destroyed: collection.isDestroyed(),
        prototypeInstrumentationInstalled: false,
      };
    },
  };
}

function createRecordOwner(kind, fixture, viewer) {
  const services = {
    geoidHeight: () => 0,
    cachedGroundFloor: () => null,
    floorAltitudeM: (altitude) => altitude,
  };
  const records =
    kind === 'flights'
      ? new FlightRecords(services)
      : new MilitaryFlightRecords(services);
  for (const contact of fixture.contacts) {
    const common = {
      id: contact.id,
      reference: contact.id,
      latitude: contact.latitude,
      longitude: contact.longitude,
      baroAltitudeM: contact.altitudeM,
      ellipsoidAltitudeM: contact.altitudeM,
      onGround: false,
      speedMps: 120,
      courseDeg: 90,
      verticalRateMps: 0,
      callsign: contact.id,
      positionTimeMs: FIXTURE_EPOCH_MS,
      contactTimeMs: FIXTURE_EPOCH_MS,
      category: 3,
      typeCode: 'A320',
    };
    if (kind === 'flights') {
      records.receive(common, {
        viewerLatDeg: fixture.camera.latitude,
        viewerLonDeg: fixture.camera.longitude,
        trackedId: contact.tracked ? contact.id : null,
        floorWarmPoints: [],
        sourceId: 'S53-fleet-audit',
        sourceSnapshotObservedAtMs: FIXTURE_EPOCH_MS,
        sourceCoverage: 'bounded-fixture',
        sourceFreshness: 'current',
        sourceComplete: contact.snapshotComplete,
      });
    } else {
      records.receive(common, {
        observedAtMs: FIXTURE_EPOCH_MS,
        floorWarmPoints: [],
        modelOwnsVisual: () => false,
        sourceId: 'S53-fleet-audit',
        sourceCoverage: 'bounded-fixture',
        sourceFreshness: 'current',
        sourceComplete: contact.snapshotComplete,
      });
    }
  }
  void viewer;
  return records;
}

function createRun(kind, fixture) {
  const { scene, camera } = sceneAndCamera(fixture.camera);
  const viewer = { scene, camera };
  const counted = countedBillboardCollection();
  const records = createRecordOwner(kind, fixture, viewer);
  const billboards = new Map();
  const positionById = new Map();
  const factorById = new Map();
  const modelStates = new Map();
  for (const contact of fixture.contacts) {
    const position = Cesium.Cartesian3.fromDegrees(
      contact.longitude,
      contact.latitude,
      contact.altitudeM,
    );
    positionById.set(
      contact.id,
      Cesium.Cartesian3.add(
        position,
        new Cesium.Cartesian3(...contact.motionOffset),
        new Cesium.Cartesian3(),
      ),
    );
    factorById.set(contact.id, contact.focusFactor);
    if (contact.billboard) {
      const billboard = counted.add({
        id: contact.id,
        position,
        color: Cesium.Color.WHITE,
        scale: 1,
        rotation: 0,
        show: true,
        image: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
        sizeInMeters: false,
        scaleByDistance: new Cesium.NearFarScalar(1000, 3, 8_000_000, 0.5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      billboards.set(contact.id, billboard);
    }
    if (contact.model.present) {
      modelStates.set(contact.id, {
        modelMatrix: new Cesium.Matrix4(),
        ready: contact.model.ready,
        show: contact.model.show,
        color: Cesium.Color.WHITE,
        colorBlendAmount: 0.9,
        changes: { show: 0, color: 0, matrix: 0 },
      });
    }
  }
  const state = {
    _viewer: viewer,
    _billboardCollection: { show: true },
    _billboards: billboards,
    _models: modelStates,
    _modelPending: new Set(),
    _modelGen: new Map(),
    _modelEpoch: 0,
    _models3dEnabled: true,
    _models3dMode: 'proximity',
    _trackedIcao:
      fixture.contacts.find((contact) => contact.tracked)?.id ?? null,
    _cockpitContactMode: false,
    _cockpitNearContacts: new Set(),
    _irBoost: false,
    _irReloadQueue: null,
    _lastFleetTickMs: 0,
    _lastCamPoseSig: '',
    _lastRotPassMs: 0,
    _lastModelCapWarnMs: 0,
    _modelCollection: null,
    _displayCourse: new Map(),
    _cullPositions: new Map(),
    _billboardLimbScale: new WeakMap(),
    _specCache: new Map(),
    _positionHistory: new Map(),
    _groundSnap: { heightFor: () => null },
    _scratchGroundCarto: new Cesium.Cartographic(),
    _scratchFleetPos: new Cesium.Cartesian3(),
    _scratchModelHpr: new Cesium.HeadingPitchRoll(),
    _scratchModelMtx: new Cesium.Matrix4(),
    _scratchModelBS: new Cesium.BoundingSphere(new Cesium.Cartesian3(), 1),
    _scratchModelPos: new Cesium.Cartesian3(),
    _scratchGroundPos: new Cesium.Cartesian3(),
    _trackedEntity: null,
    _trackedModel: null,
    records,
  };
  const services = {
    militaryRegistry: { isMilitaryIcao: () => false },
    aircraftPresentation: {
      tr3bIconKind: () => 'aircraft',
      isTr3b: () => false,
    },
    camera: { trackedModelScaleForPixelCap: () => 1 },
    focus: {
      focusNowMs: (now) => now,
      getFocusTarget: () => null,
      nearFarScalarValueAtDistance,
      advanceProjectedSpriteFocus: (billboard) => ({
        factor: factorById.get(billboard.id) ?? 1,
      }),
    },
    recession: {
      applyAircraftBillboardTreatment,
      applyAircraftModelTreatment,
    },
  };
  const parts = {
    motion: {
      _deadReckon: (id, result) =>
        Cesium.Cartesian3.clone(positionById.get(id), result),
      _floorGroundedDisplayPosition: (_id, _info, position) => position,
    },
    tracking: {
      _trackedModelRegimeActive: () => false,
      _refreshCockpitNearContacts() {},
    },
    enrichment: { _requestTypeEnrichment() {} },
  };
  const renderer =
    kind === 'flights'
      ? createFlightRendering({
          flightState: state,
          services,
          parts,
          layer: { getParams: () => ({}) },
          resolveAsset: (value) => value,
        })
      : createMilitaryRendering({
          flightState: state,
          services,
          parts,
          layer: { getParams: () => ({}) },
          resolveAsset: (value) => value,
        });
  for (const contact of fixture.contacts) {
    const model = modelStates.get(contact.id);
    if (model) {
      const originalMatrix = model.modelMatrix;
      model.modelMatrix = new Proxy(originalMatrix, {
        set(target, property, value) {
          model.changes.matrix += 1;
          return Reflect.set(target, property, value, target);
        },
      });
      for (const property of ['show', 'color']) {
        let value = model[property];
        Object.defineProperty(model, property, {
          configurable: true,
          enumerable: true,
          get: () => value,
          set(next) {
            model.changes[property] += 1;
            value = next;
          },
        });
      }
    }
  }
  return {
    scene,
    camera,
    viewer,
    counted,
    records,
    billboards,
    modelStates,
    state,
    renderer,
    positionById,
    factorById,
  };
}

function snapshotRun(context, label) {
  return {
    label,
    billboardIdentitySha256: sha256(
      Buffer.from(JSON.stringify(context.counted.identity(context.billboards))),
    ),
    billboardCount: context.billboards.size,
    writes: [...context.counted.attemptedWrites.entries()]
      .map(([billboard, counts]) => ({ id: billboard.id, ...counts }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    visibility: [...context.billboards.entries()]
      .map(([id, billboard]) => [id, billboard.show])
      .sort(([left], [right]) => left.localeCompare(right)),
    colors: [...context.billboards.entries()]
      .map(([id, billboard]) => [id, billboard.color?.alpha ?? null])
      .sort(([left], [right]) => left.localeCompare(right)),
    modelHandoffs: [...context.modelStates.entries()]
      .map(([id, model]) => ({
        id,
        ready: model.ready,
        modelShown: model.show,
        showWrites: model.changes.show,
        colorWrites: model.changes.color,
        matrixWrites: model.changes.matrix,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    collectionAdds: context.counted.totals.adds,
    collectionRemoves: context.counted.totals.removes,
  };
}

function runLayer(kind, fixture) {
  const context = createRun(kind, fixture);
  const cleanup = { modelMapEntriesBefore: context.modelStates.size };
  try {
    const identityBefore = context.counted.identity(context.billboards);
    const addCountBefore = context.counted.totals.adds;
    const removeCountBefore = context.counted.totals.removes;
    const beforeWrites = new Map(
      [...context.counted.attemptedWrites].map(([billboard, counts]) => [
        billboard,
        { ...counts },
      ]),
    );
    context.state._lastFleetTickMs = fixture.receiptClockMs - fixture.cadenceMs;
    context.renderer._fleetTick();
    const tick = snapshotRun(context, 'fleet-tick');
    tick.tickAdds = context.counted.totals.adds - addCountBefore;
    tick.tickRemoves = context.counted.totals.removes - removeCountBefore;
    tick.identityPreserved =
      JSON.stringify(identityBefore) ===
      JSON.stringify(context.counted.identity(context.billboards));
    tick.suppressedRecordAbsent = !context.billboards.has(
      fixture.contacts.find(({ role }) => role === 'suppressed').id,
    );
    tick.writeDeltas = tick.writes.map((row) => {
      const billboard = context.billboards.get(row.id);
      const prior = beforeWrites.get(billboard) || {};
      return {
        id: row.id,
        position: row.position - (prior.position || 0),
        color: row.color - (prior.color || 0),
        scale: row.scale - (prior.scale || 0),
        show: row.show - (prior.show || 0),
        rotation: row.rotation - (prior.rotation || 0),
        image: row.image - (prior.image || 0),
      };
    });
    const stationary = fixture.contacts.find(
      ({ role }) => role === 'stationary',
    );
    const modelContact = fixture.contacts.find(
      ({ role }) => role === 'model-handoff',
    );
    const moving = fixture.contacts.find(({ role }) => role === 'moving');
    const selected = fixture.contacts.find(({ role }) => role === 'selected');
    const horizon = fixture.contacts.find(
      ({ role }) => role === 'horizon-hidden',
    );
    const fading = fixture.contacts.find(({ role }) => role === 'fading');
    const byId = new Map(tick.writeDeltas.map((row) => [row.id, row]));
    tick.witnesses = {
      stationaryNoPositionWrite: byId.get(stationary.id)?.position === 0,
      movingPositionWrite: byId.get(moving.id)?.position === 1,
      selectedSkipped:
        byId.get(selected.id)?.position === 0 &&
        byId.get(selected.id)?.show === 0,
      suppressedNotInCollection: tick.suppressedRecordAbsent,
      horizonHidden: context.billboards.get(horizon.id)?.show === false,
      focusFadeApplied:
        context.billboards.get(fading.id)?.color.alpha === fading.focusFactor,
      modelHandoffCommitted:
        context.modelStates.get(modelContact.id)?.show === true &&
        context.billboards.get(modelContact.id)?.show === false,
    };
    const churn = runChurnControl(context, fixture);
    const cleanupInfo = context.counted.destroy();
    cleanup.cleanup = cleanupInfo;
    context.records.data.clear();
    context.records.missingPolls.clear();
    cleanup.recordsCleared = context.records.data.size === 0;
    cleanup.collectionDestroyed = cleanupInfo.destroyed;
    return {
      kind,
      initialIdentitySha256: sha256(
        Buffer.from(JSON.stringify(identityBefore)),
      ),
      tick,
      churn,
      cleanup,
      allocations: {
        billboardCollectionAddsDuringFleetTick: tick.tickAdds,
        billboardIdentityChurnDuringFleetTick: !tick.identityPreserved,
        cesiumCartesianAllocations: null,
        applicationHeapAllocations: null,
        gpuUploads: null,
        uploadedBytes: null,
      },
    };
  } catch (error) {
    if (!context.counted.collection.isDestroyed()) context.counted.destroy();
    context.records.data.clear();
    context.records.missingPolls.clear();
    throw error;
  }
}

function runChurnControl(context, fixture) {
  const contact = fixture.contacts.find(
    ({ role }) => role === fixture.churnControl.role,
  );
  const before = context.counted.identity(context.billboards);
  const removed = context.counted.remove(context.billboards, contact.id);
  const position = Cesium.Cartesian3.fromDegrees(
    contact.longitude,
    contact.latitude,
    contact.altitudeM,
  );
  const replacement = context.counted.add({
    id: contact.id,
    position,
    color: Cesium.Color.WHITE,
    scale: 1,
    show: true,
  });
  context.billboards.set(contact.id, replacement);
  const after = context.counted.identity(context.billboards);
  const beforeDigest = sha256(Buffer.from(JSON.stringify(before)));
  const afterDigest = sha256(Buffer.from(JSON.stringify(after)));
  return {
    role: contact.role,
    removed,
    removeCount: context.counted.totals.removes,
    addCount: context.counted.totals.adds,
    cardinalityBefore: before.length,
    cardinalityAfter: after.length,
    identityChanged: beforeDigest !== afterDigest,
    detectsChurn:
      removed && before.length === after.length && beforeDigest !== afterDigest,
  };
}

function sourceMetadata() {
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  const status = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const sourceSha256 = Object.fromEntries(
    SOURCE_FILES.map((file) => [
      file,
      sha256(readFileSync(path.join(ROOT, file))),
    ]),
  );
  const lockfile = readFileSync(path.join(ROOT, 'package-lock.json'));
  const cesiumPackageBytes = readFileSync(
    path.join(ROOT, 'node_modules/cesium/package.json'),
  );
  const cesiumPackage = JSON.parse(cesiumPackageBytes.toString('utf8'));
  if (cesiumPackage.version !== Cesium.VERSION)
    throw new Error('Installed Cesium package and API versions disagree.');
  return {
    gitHead,
    workingTreeClean: status.length === 0,
    statusSha256: sha256(Buffer.from(status)),
    sourceSha256,
    lockfileSha256: sha256(lockfile),
    installedCesiumPackageSha256: sha256(cesiumPackageBytes),
    cesiumVersion: Cesium.VERSION,
  };
}

export function createAircraftFleetTickAudit({
  fixture = createAircraftFleetTickFixtureDescriptor(),
} = {}) {
  const originalNow = Date.now;
  const report = withClock(fixture.receiptClockMs, () => ({
    schema: AIRCRAFT_FLEET_TICK_AUDIT_SCHEMA,
    fixture: {
      descriptor: fixture,
      sha256: aircraftFleetTickFixtureSha256(fixture),
    },
    source: sourceMetadata(),
    runs: [runLayer('flights', fixture), runLayer('military', fixture)],
    limitations: [
      'Deterministic producer-path audit only; no WebGL context or rendered image comparison.',
      'Only explicit Cesium BillboardCollection membership/add/remove and billboard setter attempts are counted.',
      'General JavaScript allocation, Cesium Cartesian3 allocation, GPU upload count, uploaded bytes and frame time are unavailable.',
      'The synthetic contact set is not a fleet-scale or external-feed population.',
    ],
  }));
  return {
    ...report,
    clock: {
      receiptClockMs: fixture.receiptClockMs,
      restoredAfterRun: Date.now === originalNow,
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.stdout.write(
    `${JSON.stringify(createAircraftFleetTickAudit(), null, 2)}\n`,
  );
