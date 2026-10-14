import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  compareInfrastructureSurfaceSamples,
  createInfrastructurePrimitiveCollections,
  INFRASTRUCTURE_COLLECTION_CASES,
  INFRASTRUCTURE_COLLECTION_COLOR_ENCODINGS,
  INFRASTRUCTURE_COLLECTION_PAIRS,
  INFRASTRUCTURE_COLLECTION_SCHEMA,
  infrastructureCollectionRepresentationId,
  infrastructureEffectiveColorBytes,
  infrastructureEntityEncodedColor,
  infrastructurePickCartesian,
  infrastructureSurfaceStyleEvidence,
  infrastructureModeTransitionReady,
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
    sourceStyleSha256: digest,
    pointStyleSha256: digest,
    stemNonColorStyleSha256: digest,
    effectiveStemColorSha256: digest,
    effectiveStemColorEncoding:
      mode === 'entity'
        ? 'cesium-static-rgba8-attribute'
        : 'rgba8-normalized-material-uniform',
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
    modeTransition: {
      caseId,
      pair,
      mode,
      status: 'settled',
      elapsedMs: 38,
      completedFrames: 3,
      stableFrames: 3,
      dataSourceReady: true,
      dataSourceLoading: false,
      expectedSurfaceCount: 2,
      observedSurfaceCount: 2,
      pointPickResolved: true,
      stemPickResolved: true,
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
  const warmupTransitions = ['entity', 'collection'].map((mode) => ({
    caseId: 'default-style',
    pair: -1,
    mode,
    status: 'settled',
    elapsedMs: 36,
    completedFrames: 3,
    stableFrames: 3,
    dataSourceReady: true,
    dataSourceLoading: false,
    expectedSurfaceCount: 2,
    observedSurfaceCount: 2,
    pointPickResolved: true,
    stemPickResolved: true,
  }));
  return {
    schema: INFRASTRUCTURE_COLLECTION_SCHEMA,
    applicationCommit: 'b'.repeat(40),
    harnessCommit: 'b'.repeat(40),
    candidateRepresentation: {
      id: infrastructureCollectionRepresentationId(
        'entity-color-attribute-byte',
      ),
      stemColorEncoding: 'entity-color-attribute-byte',
      styleHash:
        'Raw RGBA source/style hashes stay strict; effective stem encoding is reported separately and full-frame pixels remain exact.',
    },
    status: 'passed',
    caseCount: INFRASTRUCTURE_COLLECTION_CASES.length,
    pairsPerCase: INFRASTRUCTURE_COLLECTION_PAIRS,
    checks: [{ passed: true }],
    samples,
    modeTransitions: samples.map((entry) => entry.modeTransition),
    warmupTransitions,
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

test('Entity color-attribute encoding maps focused alpha through Cesium RGBA8 bytes', () => {
  const focusedColor = new Cesium.Color(0, 0.29, 0.77, 0.55);
  const encoded = infrastructureEntityEncodedColor(Cesium, [
    focusedColor.red,
    focusedColor.green,
    focusedColor.blue,
    focusedColor.alpha,
  ]);
  const expectedBytes =
    Cesium.ColorGeometryInstanceAttribute.toValue(focusedColor);
  assert.deepEqual(encoded.toBytes(), [...expectedBytes]);
  assert.equal(expectedBytes[3], 140);
  assert.equal(encoded.alpha, 140 / 255);
  assert.deepEqual(infrastructureEffectiveColorBytes(Cesium, focusedColor), [
    ...expectedBytes,
  ]);
  assert.deepEqual(INFRASTRUCTURE_COLLECTION_COLOR_ENCODINGS, [
    'direct-float-uniform',
    'entity-color-attribute-byte',
  ]);
  assert.throws(
    () => infrastructureCollectionRepresentationId('unknown'),
    /unsupported/,
  );
});

test('real collection candidate applies Entity-compatible focused stem alpha when selected', () => {
  const restoreDomTypes = installCesiumDomTypeShims();
  const focused = entity();
  focused.point.color = property(color(0, 0.29, 0.77, 1));
  focused.polyline.material = {
    color: property(color(0, 0.29, 0.77, 1)),
  };
  const surfaces = snapshotInfrastructureSurfaces({
    entities: [focused],
    analystRecords: [analystRecord()],
    layerId: 'local-dams',
    time: {},
  });
  let byteEncoded;
  let directFloat;
  try {
    byteEncoded = createInfrastructurePrimitiveCollections(Cesium, surfaces, {
      focusedEntityId: 'osm:dam:1',
      stemColorEncoding: 'entity-color-attribute-byte',
    });
    directFloat = createInfrastructurePrimitiveCollections(Cesium, surfaces, {
      focusedEntityId: 'osm:dam:1',
      stemColorEncoding: 'direct-float-uniform',
    });
    assert.equal(
      readInfrastructurePrimitiveSurfaces(byteEncoded)[0].stem.color[3],
      140 / 255,
    );
    assert.equal(
      readInfrastructurePrimitiveSurfaces(directFloat)[0].stem.color[3],
      0.55,
    );
  } finally {
    byteEncoded?.destroy();
    directFloat?.destroy();
    restoreDomTypes();
  }
});

test('style evidence preserves raw RGBA arrays and separates encoded material values', () => {
  const restoreDomTypes = installCesiumDomTypeShims();
  const focused = entity();
  focused.point.color = property(color(0, 0.29, 0.77, 0.55));
  focused.point.outlineColor = property(color(1, 1, 0, 1));
  focused.polyline.material = {
    color: property(color(0, 0.29, 0.77, 0.55)),
  };
  const surfaces = snapshotInfrastructureSurfaces({
    entities: [focused],
    analystRecords: [analystRecord()],
    layerId: 'local-dams',
    time: {},
  });
  let collections;
  try {
    collections = createInfrastructurePrimitiveCollections(Cesium, surfaces, {
      focusedEntityId: 'osm:dam:1',
      stemColorEncoding: 'entity-color-attribute-byte',
    });
    const actual = readInfrastructurePrimitiveSurfaces(collections)[0];
    const entityEvidence = infrastructureSurfaceStyleEvidence(
      Cesium,
      surfaces,
      'entity',
      'entity-color-attribute-byte',
    );
    const collectionSurface = {
      ...surfaces[0],
      sourcePointStyle: surfaces[0].pointStyle,
      sourceLineStyle: surfaces[0].lineStyle,
      sourceEntityShow: surfaces[0].entityShow,
      pointStyle: {
        ...surfaces[0].pointStyle,
        color: actual.point.color,
        outlineColor: actual.point.outlineColor,
        show: actual.point.show,
      },
      lineStyle: {
        ...surfaces[0].lineStyle,
        color: actual.stem.color,
        width: actual.stem.width,
        show: actual.stem.show,
      },
    };
    const collectionEvidence = infrastructureSurfaceStyleEvidence(
      Cesium,
      [collectionSurface],
      'collection',
      'entity-color-attribute-byte',
    );
    assert.deepEqual(
      entityEvidence.styles[0].stem.color,
      [0, 0.29, 0.77, 0.55],
    );
    assert.deepEqual(
      entityEvidence.sourceStyles,
      collectionEvidence.sourceStyles,
    );
    assert.deepEqual(
      entityEvidence.pointStyles,
      collectionEvidence.pointStyles,
    );
    assert.deepEqual(
      entityEvidence.stemNonColorStyles,
      collectionEvidence.stemNonColorStyles,
    );
    assert.notDeepEqual(entityEvidence.styles, collectionEvidence.styles);
    assert.deepEqual(
      entityEvidence.effectiveStemColors,
      collectionEvidence.effectiveStemColors,
    );
    assert.deepEqual(collectionEvidence.effectiveStemColors[0], [
      0,
      74 / 255,
      197 / 255,
      140 / 255,
    ]);
  } finally {
    collections?.destroy();
    restoreDomTypes();
  }
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

test('mode transition requires stable ready surfaces and both actual picks', () => {
  const observation = {
    completedFrames: 3,
    stableFrames: 3,
    dataSourceReady: true,
    dataSourceLoading: false,
    expectedSurfaceCount: 704,
    observedSurfaceCount: 704,
    pointPickResolved: true,
    stemPickResolved: true,
  };
  assert.equal(infrastructureModeTransitionReady(observation), true);
  for (const patch of [
    { dataSourceReady: false },
    { dataSourceLoading: true },
    { completedFrames: 2 },
    { stableFrames: 2 },
    { expectedSurfaceCount: 0 },
    { observedSurfaceCount: 703 },
    { pointPickResolved: false },
    { stemPickResolved: false },
    { stemPickResolved: undefined },
  ])
    assert.equal(
      infrastructureModeTransitionReady({ ...observation, ...patch }),
      false,
    );
});

test('pick target normalization accepts collection arrays and Entity Cartesians', () => {
  const pointArray = infrastructurePickCartesian(
    Cesium,
    { position: [1, 2, 3] },
    'point',
  );
  const pointCartesian = infrastructurePickCartesian(
    Cesium,
    { position: new Cesium.Cartesian3(1, 2, 3) },
    'point',
  );
  assert.ok(pointArray.equals(pointCartesian));

  const stemArray = infrastructurePickCartesian(
    Cesium,
    {
      positions: [
        [0, 0, 0],
        [0, 0, 10],
      ],
    },
    'stem',
  );
  const stemCartesian = infrastructurePickCartesian(
    Cesium,
    {
      positions: [
        new Cesium.Cartesian3(0, 0, 0),
        new Cesium.Cartesian3(0, 0, 10),
      ],
    },
    'stem',
  );
  assert.ok(stemArray.equals(stemCartesian));
  assert.throws(
    () => infrastructurePickCartesian(Cesium, { position: null }, 'point'),
    /coordinates are unavailable/,
  );
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
  assert.throws(
    () =>
      compareInfrastructureSurfaceSamples(
        { ...left, styleSha256: undefined },
        { ...right, styleSha256: undefined },
      ),
    /styleSha256 is invalid/,
  );
  assert.equal(
    compareInfrastructureSurfaceSamples(left, {
      ...right,
      effectiveStemColorSha256: 'd'.repeat(64),
    }),
    true,
  );
});

test('RGBA8 experiment preserves raw style hashes and proves exact effective stem encoding', () => {
  const entityRow = sample('focused-alpha-style', 0, 'entity');
  const collectionRow = sample('focused-alpha-style', 0, 'collection');
  collectionRow.styleSha256 = 'c'.repeat(64);
  assert.equal(
    compareInfrastructureSurfaceSamples(entityRow, collectionRow, {
      stemColorEncoding: 'entity-color-attribute-byte',
    }),
    true,
  );
  assert.notEqual(entityRow.styleSha256, collectionRow.styleSha256);
  assert.throws(
    () =>
      compareInfrastructureSurfaceSamples(entityRow, collectionRow, {
        stemColorEncoding: 'direct-float-uniform',
      }),
    /styleSha256 differs/,
  );
  assert.throws(
    () =>
      compareInfrastructureSurfaceSamples(
        entityRow,
        {
          ...collectionRow,
          sourceStyleSha256: 'd'.repeat(64),
        },
        {
          stemColorEncoding: 'entity-color-attribute-byte',
        },
      ),
    /sourceStyleSha256 differs/,
  );
  for (const field of ['pointStyleSha256', 'stemNonColorStyleSha256'])
    assert.throws(
      () =>
        compareInfrastructureSurfaceSamples(
          entityRow,
          {
            ...collectionRow,
            [field]: 'd'.repeat(64),
          },
          {
            stemColorEncoding: 'entity-color-attribute-byte',
          },
        ),
      /RGBA8 effective stem encoding evidence differs/,
    );
  assert.throws(
    () =>
      compareInfrastructureSurfaceSamples(
        entityRow,
        {
          ...collectionRow,
          effectiveStemColorSha256: 'e'.repeat(64),
        },
        {
          stemColorEncoding: 'entity-color-attribute-byte',
        },
      ),
    /RGBA8 effective stem encoding evidence differs/,
  );
  assert.throws(
    () =>
      compareInfrastructureSurfaceSamples(
        entityRow,
        {
          ...collectionRow,
          effectiveStemColorEncoding: 'float-polyline-material',
        },
        {
          stemColorEncoding: 'entity-color-attribute-byte',
        },
      ),
    /RGBA8 effective stem encoding evidence differs/,
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
  const wrongRepresentation = structuredClone(value);
  wrongRepresentation.candidateRepresentation.id =
    'point-polyline-collections/direct-float-uniform/v1';
  assert.throws(
    () =>
      validateInfrastructureCollectionReport(wrongRepresentation, {
        expectedCommit: 'b'.repeat(40),
      }),
    /representation identity is invalid/,
  );
  const noChecks = { ...value, checks: [] };
  assert.throws(
    () =>
      validateInfrastructureCollectionReport(noChecks, {
        expectedCommit: 'b'.repeat(40),
      }),
    /checks are missing/,
  );
  const missingTransition = structuredClone(value);
  delete missingTransition.samples[0].modeTransition;
  assert.throws(
    () =>
      validateInfrastructureCollectionReport(missingTransition, {
        expectedCommit: 'b'.repeat(40),
      }),
    /invalid evidence/,
  );
  const incompleteWarmup = structuredClone(value);
  incompleteWarmup.warmupTransitions[0].stemPickResolved = false;
  assert.throws(
    () =>
      validateInfrastructureCollectionReport(incompleteWarmup, {
        expectedCommit: 'b'.repeat(40),
      }),
    /warmup is invalid/,
  );
  const failedTransition = structuredClone(value);
  failedTransition.modeTransitions[0].stemPickResolved = false;
  failedTransition.samples[0].modeTransition.stemPickResolved = false;
  assert.throws(
    () =>
      validateInfrastructureCollectionReport(failedTransition, {
        expectedCommit: 'b'.repeat(40),
      }),
    /invalid evidence/,
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
