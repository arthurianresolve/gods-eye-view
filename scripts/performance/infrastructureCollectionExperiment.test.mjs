import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  compareInfrastructureSurfaceSamples,
  createInfrastructurePrimitiveCollections,
  INFRASTRUCTURE_COLLECTION_CASES,
  INFRASTRUCTURE_COLLECTION_PAIRS,
  INFRASTRUCTURE_COLLECTION_SCHEMA,
  matchesInfrastructureCollectionPick,
  snapshotInfrastructureSurfaces,
  readInfrastructurePrimitiveSurfaces,
  validateInfrastructureCollectionReport,
} from './infrastructureCollectionExperiment.mjs';

const color = (red, green, blue, alpha = 1) => ({ red, green, blue, alpha });
const property = (value) => ({ getValue: () => value });

function entity(id = 'osm:dam:1', sourceId = id) {
  return {
    id,
    show: true,
    properties: property({ osm_id: sourceId }),
    position: property({ x: 1, y: 2, z: 3 }),
    point: {
      pixelSize: property(10),
      color: property(color(0, 0.5, 1)),
      outlineColor: property(color(0, 0, 0)),
      outlineWidth: property(2),
      disableDepthTestDistance: property(Number.POSITIVE_INFINITY),
      show: property(true),
    },
    polyline: {
      positions: property([
        { x: 1, y: 2, z: 0 },
        { x: 1, y: 2, z: 3 },
      ]),
      width: property(3.5),
      material: { color: property(color(0, 0.5, 1)) },
      show: property(true),
    },
  };
}

function analystRecord(id = 'osm:dam:1') {
  return {
    id: 'Dam one',
    sourceRecordId: id,
    evidence: { entityRef: { layerKey: 'local-dams', id } },
  };
}

const digest = 'a'.repeat(64);

function sample(caseId, pair, mode) {
  return {
    caseId,
    pair,
    mode,
    sourceFeatureCount: 3,
    renderEntityCount: 3,
    surfaceCount: 2,
    pointCount: 2,
    stemCount: 2,
    visiblePointCount: 2,
    visibleStemCount: 2,
    lineOnlyEntityCount: 1,
    polygonEntityCount: 0,
    identitySha256: digest,
    positionSha256: digest,
    styleSha256: digest,
    sourceGeometryKindsSha256: digest,
    renderEntityKindsSha256: digest,
    pixelSha256: digest,
    pixelDifferenceCount: 0,
    frame: {
      width: 1200,
      height: 960,
      elapsedMs: 16,
      pixelsDifferentFromCorner: 1000,
    },
    pointPick: {
      sourceRecordId: 'osm:dam:1',
      entityId: 'osm:dam:1',
      kind: 'point',
      screen: [100, 200],
    },
    stemPick: {
      sourceRecordId: 'osm:dam:1',
      entityId: 'osm:dam:1',
      kind: 'stem',
      screen: [110, 220],
    },
  };
}

function report() {
  const samples = [];
  for (const caseId of INFRASTRUCTURE_COLLECTION_CASES) {
    for (let pair = 0; pair < INFRASTRUCTURE_COLLECTION_PAIRS; pair++) {
      samples.push(sample(caseId, pair, 'entity'));
      samples.push(sample(caseId, pair, 'collection'));
    }
  }
  return {
    schema: INFRASTRUCTURE_COLLECTION_SCHEMA,
    applicationCommit: 'b'.repeat(40),
    harnessCommit: 'b'.repeat(40),
    status: 'passed',
    caseCount: INFRASTRUCTURE_COLLECTION_CASES.length,
    pairsPerCase: INFRASTRUCTURE_COLLECTION_PAIRS,
    checks: [{ passed: true }],
    samples,
    cleanup: {
      viewerDestroyed: true,
      layersDestroyed: true,
      pointCollectionDestroyed: true,
      polylineCollectionDestroyed: true,
      collectionParentDestroyed: true,
      glInstrumentationRestored: true,
      instrumentationRestored: true,
      entityVisibilityRestored: true,
    },
  };
}

test('snapshots actual Entity point/stem values with canonical source identity', () => {
  const [surface] = snapshotInfrastructureSurfaces({
    entities: [entity()],
    analystRecords: [analystRecord()],
    layerId: 'local-dams',
    time: {},
  });
  assert.equal(surface.entityId, 'osm:dam:1');
  assert.equal(surface.sourceRecordId, 'osm:dam:1');
  assert.equal(surface.pointStyle.disableDepthTestDistance, 'infinity');
  assert.equal(surface.positions.length, 2);
  assert.deepEqual(surface.pointStyle.color, [0, 0.5, 1, 1]);
});

test('surface snapshot rejects missing, duplicate, or cross-layer identity', () => {
  const options = {
    entities: [entity()],
    analystRecords: [analystRecord()],
    layerId: 'local-dams',
    time: {},
  };
  assert.throws(
    () => snapshotInfrastructureSurfaces({ ...options, analystRecords: [] }),
    /canonical analyst record/,
  );
  assert.throws(
    () =>
      snapshotInfrastructureSurfaces({
        ...options,
        analystRecords: [
          analystRecord(),
          { ...analystRecord(), id: 'Other dam' },
        ],
      }),
    /contradictory analyst records/,
  );
  assert.throws(
    () =>
      snapshotInfrastructureSurfaces({
        ...options,
        analystRecords: [
          {
            ...analystRecord(),
            evidence: {
              entityRef: { layerKey: 'local-datacenters', id: 'osm:dam:1' },
            },
          },
        ],
      }),
    /wrong source layer/,
  );
});

test('multipart rendered Entities retain unique ids and shared canonical feature identity', () => {
  const surfaces = snapshotInfrastructureSurfaces({
    entities: [entity('osm:dam:1'), entity('osm:dam:1_2', 'osm:dam:1')],
    analystRecords: [analystRecord()],
    layerId: 'local-dams',
    time: {},
  });
  assert.deepEqual(
    surfaces.map((surface) => surface.entityId),
    ['osm:dam:1', 'osm:dam:1_2'],
  );
  assert.deepEqual(
    surfaces.map((surface) => surface.sourceRecordId),
    ['osm:dam:1', 'osm:dam:1'],
  );
});

test('real Cesium collections preserve values across non-destroying detach and reattach', () => {
  const surfaces = snapshotInfrastructureSurfaces({
    entities: [entity()],
    analystRecords: [analystRecord()],
    layerId: 'local-dams',
    time: {},
  });
  const restoreDomTypes = installCesiumDomTypeShims();
  let collections;
  let parent;
  try {
    collections = createInfrastructurePrimitiveCollections(Cesium, surfaces);
    parent = new Cesium.PrimitiveCollection({ destroyPrimitives: false });
    const point = parent.add(collections.points);
    const stem = parent.add(collections.stems);
    const first = readInfrastructurePrimitiveSurfaces(collections);
    assert.equal(first.length, 1);
    assert.equal(first[0].entityId, 'osm:dam:1');
    assert.deepEqual(first[0].point.position, [1, 2, 3]);
    assert.deepEqual(first[0].point.color, [0, 0.5, 1, 1]);
    assert.deepEqual(first[0].point.outlineColor, [0, 0, 0, 1]);
    assert.equal(first[0].point.pixelSize, 10);
    assert.equal(first[0].point.outlineWidth, 2);
    assert.deepEqual(first[0].stem.positions, [
      [1, 2, 0],
      [1, 2, 3],
    ]);
    assert.deepEqual(first[0].stem.color, [0, 0.5, 1, 1]);
    assert.equal(first[0].stem.width, 3.5);
    assert.equal(first[0].point.show, true);
    assert.equal(first[0].stem.show, true);
    assert.equal(first[0].point.disableDepthTestDistance, 'infinity');
    assert.equal(parent.remove(point), true);
    assert.equal(parent.remove(stem), true);
    assert.equal(collections.isDestroyed(), false);
    parent.add(collections.points);
    parent.add(collections.stems);
    assert.equal(
      readInfrastructurePrimitiveSurfaces(collections)[0].sourceRecordId,
      'osm:dam:1',
    );
  } finally {
    if (parent && !parent.isDestroyed()) {
      if (collections && !collections.isDestroyed()) {
        parent.remove(collections.points);
        parent.remove(collections.stems);
      }
      parent.destroy();
    }
    collections?.destroy();
    restoreDomTypes();
  }
  assert.equal(collections.isDestroyed(), true);
});

test('real Cesium item pick IDs resolve individual point and polyline items', () => {
  const restoreDomTypes = installCesiumDomTypeShims();
  let collections;
  try {
    const surfaces = snapshotInfrastructureSurfaces({
      entities: [entity()],
      analystRecords: [analystRecord()],
      layerId: 'local-dams',
      time: {},
    });
    collections = createInfrastructurePrimitiveCollections(Cesium, surfaces);
    const context = {
      createPickId: (value) => ({ ...value, destroy() {} }),
    };
    const point = collections.points.get(0);
    const stem = collections.stems.get(0);
    const pointPick = point.getPickId(context);
    const stemPick = stem.getPickId(context);

    assert.equal(pointPick.primitive, point);
    assert.equal(pointPick.collection, collections.points);
    assert.equal(pointPick.id.kind, 'point');
    assert.equal(
      matchesInfrastructureCollectionPick(
        pointPick,
        collections,
        'osm:dam:1',
        'point',
      ),
      true,
    );
    assert.equal(stemPick.primitive, stem);
    assert.equal(stemPick.collection, collections.stems);
    assert.equal(stemPick.id.kind, 'stem');
    assert.equal(
      matchesInfrastructureCollectionPick(
        stemPick,
        collections,
        'osm:dam:1',
        'stem',
      ),
      true,
    );
    assert.equal(
      matchesInfrastructureCollectionPick(
        pointPick,
        collections,
        'osm:dam:1',
        'stem',
      ),
      false,
    );
    assert.equal(
      matchesInfrastructureCollectionPick(
        pointPick,
        collections,
        'missing-entity',
        'point',
      ),
      false,
    );
    assert.equal(
      matchesInfrastructureCollectionPick(
        pointPick,
        collections,
        'osm:dam:1',
        'unknown',
      ),
      false,
    );
  } finally {
    collections?.destroy();
    restoreDomTypes();
  }
});

test('real Cesium scene parent destroys fixture parent exactly through owned removal', () => {
  const restoreDomTypes = installCesiumDomTypeShims();
  const scenePrimitives = new Cesium.PrimitiveCollection();
  const parent = new Cesium.PrimitiveCollection({ destroyPrimitives: false });
  try {
    scenePrimitives.add(parent);
    assert.equal(scenePrimitives.remove(parent), true);
    assert.equal(parent.isDestroyed(), true);
  } finally {
    if (!scenePrimitives.isDestroyed()) scenePrimitives.destroy();
    restoreDomTypes();
  }
});

test('real Cesium primitive adapter cleans partial construction on invalid input', () => {
  const restoreDomTypes = installCesiumDomTypeShims();
  const surfaces = snapshotInfrastructureSurfaces({
    entities: [entity()],
    analystRecords: [analystRecord()],
    layerId: 'local-dams',
    time: {},
  });
  const created = [];
  class TrackedPoints extends Cesium.PointPrimitiveCollection {
    constructor(...args) {
      super(...args);
      created.push(this);
    }
  }
  class TrackedPolylines extends Cesium.PolylineCollection {
    constructor(...args) {
      super(...args);
      created.push(this);
    }
  }
  try {
    assert.throws(
      () =>
        createInfrastructurePrimitiveCollections(
          {
            ...Cesium,
            PointPrimitiveCollection: TrackedPoints,
            PolylineCollection: TrackedPolylines,
          },
          [surfaces[0], null],
        ),
      /entityId/,
    );
    assert.equal(created.length, 2);
    assert.deepEqual(
      created.map((collection) => collection.isDestroyed()),
      [true, true],
    );
  } finally {
    restoreDomTypes();
  }
});

test('adapter releases the first real collection if the second constructor throws', () => {
  const restoreDomTypes = installCesiumDomTypeShims();
  const surfaces = snapshotInfrastructureSurfaces({
    entities: [entity()],
    analystRecords: [analystRecord()],
    layerId: 'local-dams',
    time: {},
  });
  const createdPoints = [];
  class TrackedPoints extends Cesium.PointPrimitiveCollection {
    constructor(...args) {
      super(...args);
      createdPoints.push(this);
    }
  }
  class ThrowingPolylines {
    constructor() {
      throw new Error('polyline constructor fault');
    }
  }
  try {
    assert.throws(
      () =>
        createInfrastructurePrimitiveCollections(
          {
            ...Cesium,
            PointPrimitiveCollection: TrackedPoints,
            PolylineCollection: ThrowingPolylines,
          },
          surfaces,
        ),
      /polyline constructor fault/,
    );
    assert.equal(createdPoints.length, 1);
    assert.equal(createdPoints[0].isDestroyed(), true);
  } finally {
    restoreDomTypes();
  }
});

function installCesiumDomTypeShims() {
  const names = [
    'HTMLCanvasElement',
    'HTMLImageElement',
    'ImageBitmap',
    'OffscreenCanvas',
  ];
  const previous = new Map(
    names.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  for (const name of names) {
    if (!(name in globalThis))
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: class {},
      });
  }
  return () => {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

test('matched samples require exact source, pose, style, pixel, pick, and cleanup parity', () => {
  const left = sample('default-style', 0, 'entity');
  const right = sample('default-style', 0, 'collection');
  assert.equal(compareInfrastructureSurfaceSamples(left, right), true);
  for (const [field, value] of [
    ['positionSha256', 'c'.repeat(64)],
    ['styleSha256', 'c'.repeat(64)],
    ['pixelSha256', 'c'.repeat(64)],
  ]) {
    assert.throws(
      () =>
        compareInfrastructureSurfaceSamples(left, { ...right, [field]: value }),
      /differs/,
    );
  }
  assert.throws(
    () =>
      compareInfrastructureSurfaceSamples(left, {
        ...right,
        pixelDifferenceCount: 1,
      }),
    /pixel comparison failed/,
  );
  assert.throws(
    () =>
      compareInfrastructureSurfaceSamples(left, {
        ...right,
        stemPick: {
          sourceRecordId: 'osm:dam:1',
          entityId: 'other',
          kind: 'stem',
        },
      }),
    /stem pick identity/,
  );
  assert.throws(
    () =>
      compareInfrastructureSurfaceSamples(left, {
        ...right,
        pixelSha256: undefined,
      }),
    /pixelSha256 is missing/,
  );
});

test('report validator checks complete unique pair inventory and rejects weak evidence', () => {
  const value = report();
  assert.equal(
    validateInfrastructureCollectionReport(value, {
      expectedCommit: 'b'.repeat(40),
    }),
    true,
  );
  const noChecks = { ...value, checks: [] };
  assert.throws(
    () =>
      validateInfrastructureCollectionReport(noChecks, {
        expectedCommit: 'b'.repeat(40),
      }),
    /checks are missing/,
  );
  const duplicate = structuredClone(value);
  duplicate.samples[1].pair = 0;
  duplicate.samples[1].mode = 'entity';
  assert.throws(
    () =>
      validateInfrastructureCollectionReport(duplicate, {
        expectedCommit: 'b'.repeat(40),
      }),
    /incomplete|duplicated/,
  );
  const weakHashes = structuredClone(value);
  weakHashes.samples[0].pixelSha256 = undefined;
  assert.throws(
    () =>
      validateInfrastructureCollectionReport(weakHashes, {
        expectedCommit: 'b'.repeat(40),
      }),
    /invalid evidence/,
  );
  const weakPick = structuredClone(value);
  weakPick.samples[0].pointPick.screen = [NaN, 2];
  assert.throws(
    () =>
      validateInfrastructureCollectionReport(weakPick, {
        expectedCommit: 'b'.repeat(40),
      }),
    /invalid pointPick/,
  );
  const blank = structuredClone(value);
  blank.samples[0].frame.pixelsDifferentFromCorner = 0;
  assert.throws(
    () =>
      validateInfrastructureCollectionReport(blank, {
        expectedCommit: 'b'.repeat(40),
      }),
    /invalid evidence/,
  );
  const cleanup = structuredClone(value);
  cleanup.cleanup.pointCollectionDestroyed = false;
  assert.throws(
    () =>
      validateInfrastructureCollectionReport(cleanup, {
        expectedCommit: 'b'.repeat(40),
      }),
    /not released/,
  );
});
