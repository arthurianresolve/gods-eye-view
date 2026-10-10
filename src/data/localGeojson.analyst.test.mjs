// Focused tests for the local-infrastructure analyst-record mapper and snapshot seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createLocalGeoJsonLayer, mapAnalystRecord } from './localGeojson.js';
import { createLocalGeoJsonLayer as createCoreLocalGeoJsonLayer } from './localGeojsonCore.js';

const DC_RAW = {
  id: '1176042553',
  lat: -52.942,
  lon: -70.85,
  properties: {
    tags: {
      name: 'AWS',
      operator: 'Amazon Web Services',
      'operator:short': 'AWS',
      'capacity:it_load': '27 MW',
    },
  },
};

const DAM_RAW = {
  id: '-19685440',
  lat: -25.41,
  lon: -54.59,
  properties: {
    name: 'Usina Hidrelétrica de Itaipu',
    output: '14000 MW',
    tags: {
      name: 'Usina Hidrelétrica de Itaipu',
      'name:en': 'Itaipu Dam',
      operator: 'Itaipú Binacional',
      associated_river: 'Paraná',
      'plant:output:electricity': '14000 MW',
    },
  },
};

test('infra analyst record: datacenter maps name, operator, capacity', () => {
  const r = mapAnalystRecord(DC_RAW, 'local-datacenters');
  assert.deepEqual(
    { ...r, sourceRecordId: undefined, evidence: undefined },
    {
      id: 'AWS',
      name: 'AWS',
      lat: -52.942,
      lon: -70.85,
      operator: 'Amazon Web Services',
      capacity: '27 MW',
      river: null,
      output: null,
      sourceRecordId: undefined,
      evidence: undefined,
    },
  );
  assert.equal(r.sourceRecordId, '1176042553');
  assert.equal(r.evidence.sourceId, 'OpenStreetMap contributors');
  assert.equal(r.evidence.licenseRef, 'ODbL-1.0');
});

test('infra analyst record: dam maps name, operator, river, output; names stay unclamped', () => {
  const r = mapAnalystRecord(DAM_RAW, 'local-dams');
  assert.equal(r.id, 'Usina Hidrelétrica de Itaipu');
  assert.equal(r.name, 'Usina Hidrelétrica de Itaipu');
  assert.equal(r.operator, 'Itaipú Binacional');
  assert.equal(r.river, 'Paraná');
  assert.equal(r.output, '14000 MW');
  assert.equal(r.capacity, null);
});

test('infra analyst record: unnamed feature falls back to source id', () => {
  const r = mapAnalystRecord(
    {
      id: 'dc-42',
      lat: 30.2,
      lon: -97.7,
      properties: { tags: { operator: 'Example Cloud' } },
    },
    'local-datacenters',
  );
  assert.equal(r.id, 'dc-42');
  assert.equal(r.name, null);
  assert.equal(r.operator, 'Example Cloud');
});

test('infra analyst record: empty record yields nulls, never NaN/undefined', () => {
  const r = mapAnalystRecord(undefined, 'local-dams');
  assert.equal(r.id, 'Dam');
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number')
      assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('infra analyst record: output is JSON-safe (no Cesium types leak)', () => {
  const r = mapAnalystRecord(
    {
      ...DAM_RAW,
      entity: {},
      position: { x: 1 },
    },
    'local-dams',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.equal('entity' in r, false);
  assert.equal('position' in r, false);
});

class MockLayerEvent {
  constructor() {
    this.listeners = new Set();
  }

  addEventListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

test('infra getAnalystRecords: enabled layer snapshots loaded stems; disable returns []', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { dispatchEvent() {} };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        type: 'Feature',
        id: 'runtime-dam',
        properties: {
          name: 'Runtime Dam',
          output: '12 MW',
          tags: { associated_river: 'Test River', operator: 'Test Hydro' },
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-97.7, 30.2],
              [-97.69, 30.2],
              [-97.69, 30.21],
              [-97.7, 30.2],
            ],
          ],
        },
      }),
  });
  const viewer = {
    selectedEntity: undefined,
    dataSources: {
      add(dataSource) {
        return dataSource;
      },
      remove() {
        return true;
      },
    },
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(-97.695, 30.205, 100_000),
      frustum: { fov: Math.PI / 3 },
      moveEnd: new MockLayerEvent(),
      flyTo() {},
    },
    scene: {
      canvas: { clientWidth: 800, clientHeight: 600 },
      preRender: new MockLayerEvent(),
      sampleHeightSupported: false,
      sampleHeight() {
        return undefined;
      },
      screenSpaceCameraController: { enableInputs: true },
      pick() {
        return null;
      },
      requestRender() {},
    },
  };
  const layer = createLocalGeoJsonLayer({
    id: 'local-dams',
    url: '/runtime-dam.geojsonl',
    name: 'Runtime Dams',
    color: '#0088ff',
    overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
    projectToWindow: () => ({ x: 400, y: 300 }),
    screenSpaceEventHandlerFactory: () => ({
      setInputAction() {},
      destroy() {},
    }),
  });
  try {
    assert.deepEqual(
      layer.getAnalystRecords(),
      [],
      'unenabled layer has no analyst records',
    );
    await layer.enable(viewer);
    const rows = layer.getAnalystRecords();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'Runtime Dam');
    assert.equal(rows[0].name, 'Runtime Dam');
    assert.equal(rows[0].operator, 'Test Hydro');
    assert.equal(rows[0].river, 'Test River');
    assert.equal(rows[0].output, '12 MW');
    assert.ok(Number.isFinite(rows[0].lat) && Number.isFinite(rows[0].lon));
    assert.deepEqual(JSON.parse(JSON.stringify(rows[0])), rows[0]);
    assert.equal(
      layer.getAnalystRecords(0).length,
      1,
      'non-finite/zero cap still returns at least one',
    );

    layer.disable(viewer);
    assert.deepEqual(
      layer.getAnalystRecords(),
      [],
      'disable keeps stems but analyst snapshot is empty',
    );
  } finally {
    layer.destroy(viewer);
    assert.deepEqual(
      layer.getAnalystRecords(),
      [],
      'destroy releases analyst records',
    );
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('source identities survive render rebuilds, duplicate names, and detached snapshots', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const features = [
    {
      type: 'Feature',
      id: 'way/101',
      properties: {
        osm_id: '101',
        tags: { name: 'Shared Facility', operator: 'Operator A' },
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-97.72, 30.2],
            [-97.68, 30.2],
            [-97.68, 30.22],
            [-97.72, 30.2],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      id: 'way/202',
      properties: {
        osm_id: '202',
        tags: { name: 'Shared Facility', operator: 'Operator B' },
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-97.6, 30.3],
            [-97.59, 30.3],
            [-97.59, 30.31],
            [-97.6, 30.3],
          ],
        ],
      },
    },
  ];
  const sourceText = features
    .map((feature) => JSON.stringify(feature))
    .join('\n');
  let fetchCount = 0;
  let pickedEntity = null;
  let clickAction = null;
  const selectedEntities = [];
  const contexts = new Map();
  const viewer = {
    selectedEntity: undefined,
    dataSources: {
      sources: [],
      add(dataSource) {
        this.sources.push(dataSource);
        return dataSource;
      },
      remove(dataSource) {
        this.sources = this.sources.filter((source) => source !== dataSource);
        return true;
      },
    },
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(-97.7, 30.25, 100_000),
      frustum: { fov: Math.PI / 3 },
      moveEnd: new MockLayerEvent(),
      flyTo() {},
    },
    scene: {
      canvas: { clientWidth: 800, clientHeight: 600 },
      preRender: new MockLayerEvent(),
      sampleHeightSupported: false,
      screenSpaceCameraController: { enableInputs: true },
      pick() {
        return pickedEntity ? { id: pickedEntity } : null;
      },
      requestRender() {},
    },
  };
  globalThis.window = { dispatchEvent() {} };
  globalThis.fetch = async () => {
    fetchCount++;
    return { ok: true, status: 200, text: async () => sourceText };
  };
  const layer = createCoreLocalGeoJsonLayer(
    {
      id: 'local-datacenters',
      url: '/duplicate-datacenters.geojsonl',
      name: 'Datacenters',
      color: '#00ffff',
      source: 'OpenStreetMap contributors',
      osmDerived: true,
      labels: false,
      screenSpaceEventHandlerFactory: () => ({
        setInputAction(handler) {
          clickAction = handler;
        },
        destroy() {
          clickAction = null;
        },
      }),
    },
    {
      overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
      registerEntityContext(entity, metadata) {
        contexts.set(metadata.id, { entity, ...metadata });
      },
      removeEntityContextsForLayer(layerId) {
        for (const [contextId, context] of contexts) {
          if (context.layerId === layerId) contexts.delete(contextId);
        }
      },
      clearSelectedEntityContextForLayer() {},
      selectEntityContext(entity) {
        selectedEntities.push(entity);
      },
    },
  );

  try {
    await layer.enable(viewer);
    const first = layer.getAnalystRecords();
    assert.deepEqual(
      first.map((record) => record.id),
      ['Shared Facility', 'Shared Facility'],
    );
    assert.deepEqual(
      first.map((record) => record.sourceRecordId),
      ['101', '202'],
    );
    assert.equal(first[0].operator, 'Operator A');
    assert.equal(first[1].operator, 'Operator B');
    assert.equal(first[0].evidence.references[0].kind, 'peeringdb');
    const stableRows = JSON.parse(JSON.stringify(first));
    assert.equal(contexts.size, 2);
    assert.deepEqual(
      [...contexts.keys()],
      ['local-datacenters:way/101', 'local-datacenters:way/202'],
    );
    const oldRenderEntity = contexts.get('local-datacenters:way/101').entity;
    pickedEntity = oldRenderEntity;
    clickAction({ position: { x: 1, y: 1 } });
    assert.equal(viewer.selectedEntity, oldRenderEntity);
    assert.equal(selectedEntities.length, 1);

    // Analyst snapshots are detached; changing one query result cannot
    // mutate the canonical source record used by the next query.
    const originalEvidence = stableRows[0].evidence;
    const nextSnapshot = layer.getAnalystRecords()[0];
    assert.notEqual(first[0].evidence, nextSnapshot.evidence);
    assert.notEqual(
      first[0].evidence.references,
      nextSnapshot.evidence.references,
    );
    assert.throws(() => {
      first[0].evidence.references[0].title = 'mutated by caller';
    }, TypeError);
    first[0].operator = 'mutated by caller';
    contexts.get('local-datacenters:way/101').entity.properties = undefined;
    const detachedSnapshot = layer.getAnalystRecords()[0];
    assert.equal(detachedSnapshot.operator, 'Operator A');
    assert.deepEqual(detachedSnapshot.evidence, originalEvidence);

    const expectedCenter = Cesium.Cartographic.fromCartesian(
      Cesium.BoundingSphere.fromPoints(
        features[0].geometry.coordinates[0].map(([lon, lat]) =>
          Cesium.Cartesian3.fromDegrees(lon, lat),
        ),
      ).center,
    );
    const beforeDisable = layer.getAnalystRecords()[0];
    assert.ok(
      Math.abs(
        beforeDisable.lat - Cesium.Math.toDegrees(expectedCenter.latitude),
      ) < 1e-10,
    );
    assert.ok(
      Math.abs(
        beforeDisable.lon - Cesium.Math.toDegrees(expectedCenter.longitude),
      ) < 1e-10,
    );

    layer.disable(viewer);
    assert.equal(contexts.size, 0);
    assert.equal(viewer.selectedEntity, undefined);
    assert.deepEqual(layer.getAnalystRecords(), []);
    await layer.enable(viewer);
    const rebuilt = layer.getAnalystRecords();
    assert.deepEqual(rebuilt, stableRows);
    assert.equal(fetchCount, 1, 'rebuild reuses parsed source data');
    assert.equal(contexts.size, 2);
    const currentRenderEntity = contexts.get(
      'local-datacenters:way/101',
    ).entity;
    assert.notEqual(currentRenderEntity, oldRenderEntity);
    viewer.selectedEntity = undefined;
    pickedEntity = oldRenderEntity;
    clickAction({ position: { x: 1, y: 1 } });
    assert.equal(viewer.selectedEntity, undefined);
    assert.equal(selectedEntities.length, 1, 'old render entity is inert');
    pickedEntity = currentRenderEntity;
    clickAction({ position: { x: 1, y: 1 } });
    assert.equal(viewer.selectedEntity, currentRenderEntity);
    assert.equal(
      selectedEntities.length,
      2,
      'current render entity still picks',
    );
  } finally {
    layer.destroy(viewer);
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
