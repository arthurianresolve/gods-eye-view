import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import { createSubmarineCableLayer } from './index.js';
import { createIngestion } from './ingestion.js';
import { createInteraction } from './interaction.js';
import { createRendering } from './rendering.js';
import { createState } from './state.js';
import { createLifecycle } from './lifecycle.js';
import {
  createCableOverlayEntry,
  updateCableReferenceStem,
} from './overlay.js';

function overlayHost() {
  return {
    clearSource() {},
    setEntries() {},
    setVisible() {},
  };
}

test('reference collection rendering is explicit and the default remains entities', () => {
  const source = { label: 'fixture', async fetch() {} };
  const defaults = createSubmarineCableLayer({
    source,
    overlayHost: overlayHost(),
  });
  const candidate = createSubmarineCableLayer({
    source,
    overlayHost: overlayHost(),
    referenceRenderer: 'collections',
  });

  assert.equal(
    defaults.getPerformanceDiagnostics().referenceRenderer,
    'entities',
  );
  assert.equal(
    candidate.getPerformanceDiagnostics().referenceRenderer,
    'collections',
  );
  assert.throws(
    () =>
      createSubmarineCableLayer({
        source,
        overlayHost: overlayHost(),
        referenceRenderer: 'unknown',
      }),
    /referenceRenderer/,
  );
});

test('camera moveEnd forces cable stems to the exact final pose after epsilon suppression', () => {
  const finalDistance = 10_000;
  const canvasHeight = 640;
  const fov = Math.PI / 3;
  const expectedTipHeight =
    finalDistance * ((2 * Math.tan(fov / 2)) / canvasHeight) * 66;
  const expectedTip = Cesium.Cartesian3.fromDegrees(0, 0, expectedTipHeight);

  function runPath(previousDistance) {
    const base = Cesium.Cartesian3.fromDegrees(0, 0, 0);
    const initialTip = Cesium.Cartesian3.fromDegrees(0, 0, 700);
    const firstBuffer = [base, initialTip];
    const secondBuffer = [base, initialTip];
    const record = {
      id: `reference-${previousDistance}`,
      entity: {
        id: `reference-${previousDistance}`,
        show: false,
        position: new Cesium.ConstantPositionProperty(initialTip),
        polyline: { positions: new Cesium.ConstantProperty(firstBuffer) },
      },
      base,
      tip: initialTip,
      nextTip: Cesium.Cartesian3.clone(initialTip),
      stemPositionBuffers: [firstBuffer, secondBuffer],
      stemPositionBufferIndex: 0,
      pointPrimitive: null,
      polylinePrimitive: null,
      reference: { lon: 0, lat: 0 },
      kind: 'cable',
      label: 'Final pose fixture',
      visible: false,
      distanceM: Infinity,
    };
    record.entry = createCableOverlayEntry(record);

    // Pin the root cause: ordinary moving sweeps retain prior geometry when
    // the final delta is inside the sub-metre settle epsilon.
    const unforced = {
      ...record,
      tip: Cesium.Cartesian3.clone(initialTip),
      nextTip: Cesium.Cartesian3.clone(initialTip),
      stemPositionBuffers: [
        [base, initialTip],
        [base, initialTip],
      ],
      entity: {
        position: new Cesium.ConstantPositionProperty(initialTip),
        polyline: {
          positions: new Cesium.ConstantProperty([base, initialTip]),
        },
      },
      stemPositionBufferIndex: 0,
    };
    updateCableReferenceStem(
      unforced,
      Cesium.Cartesian3.fromDegrees(0, 0, previousDistance),
      canvasHeight,
      fov,
    );
    const ordinaryFinalUpdate = updateCableReferenceStem(
      unforced,
      Cesium.Cartesian3.fromDegrees(0, 0, finalDistance),
      canvasHeight,
      fov,
    );
    const ordinaryFinalError = Cesium.Cartesian3.distance(
      unforced.tip,
      expectedTip,
    );

    const scene = {
      preRender: new Cesium.Event(),
      globe: { show: true },
      canvas: { clientHeight: canvasHeight },
      requestRender() {},
    };
    const camera = {
      positionWC: Cesium.Cartesian3.fromDegrees(0, 0, previousDistance),
      frustum: { fov },
      moveEnd: new Cesium.Event(),
    };
    const viewer = {
      scene,
      camera,
      dataSources: {
        remove() {
          return true;
        },
      },
    };
    const state = createState({ overlayHost: overlayHost() });
    state._enabled = true;
    state._loaded = true;
    state._markerBlendDone = true;
    state._referenceRecords = [record];
    const parts = {
      rendering: createRendering({ state }),
      interaction: { beginInteraction() {} },
      ingestion: { load() {} },
    };
    const layer = createLifecycle({
      state,
      parts,
      source: { label: 'fixture' },
    });
    layer.init(viewer);

    scene.preRender.raiseEvent();
    camera.positionWC = Cesium.Cartesian3.fromDegrees(0, 0, finalDistance);
    camera.moveEnd.raiseEvent();
    scene.preRender.raiseEvent();

    const finalTip = Cesium.Cartesian3.clone(record.tip);
    layer.destroy(viewer);
    return { finalTip, ordinaryFinalUpdate, ordinaryFinalError };
  }

  const nearPath = runPath(finalDistance + 3);
  const coarsePath = runPath(finalDistance + 20);
  assert.equal(nearPath.ordinaryFinalUpdate, false);
  assert.ok(nearPath.ordinaryFinalError > 0);
  assert.ok(nearPath.ordinaryFinalError <= 0.5);
  assert.equal(coarsePath.ordinaryFinalUpdate, true);
  assert.equal(coarsePath.ordinaryFinalError, 0);
  assert.deepEqual(nearPath.finalTip, expectedTip);
  assert.deepEqual(coarsePath.finalTip, expectedTip);
});

test('owned reference collections preserve metadata IDs, style, sweep, picks, and teardown', (t) => {
  for (const name of [
    'HTMLCanvasElement',
    'HTMLImageElement',
    'ImageBitmap',
    'OffscreenCanvas',
  ]) {
    const previous = globalThis[name];
    globalThis[name] = class {};
    t.after(() => {
      if (previous === undefined) delete globalThis[name];
      else globalThis[name] = previous;
    });
  }
  const state = createState({
    sweepClock: () => 0,
    overlayHost: overlayHost(),
    referenceRenderer: 'collections',
  });
  state._enabled = true;
  state._referenceDataSource = new Cesium.CustomDataSource(
    'reference metadata',
  );
  const scenePrimitives = new Cesium.PrimitiveCollection();
  const removedDataSources = [];
  const viewer = {
    scene: {
      primitives: scenePrimitives,
      canvas: { clientHeight: 900 },
      requestRender() {},
    },
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(0, 0, 8_000),
      frustum: { fov: Math.PI / 3 },
    },
    dataSources: {
      remove(dataSource) {
        removedDataSources.push(dataSource);
        return true;
      },
    },
  };
  state._viewer = viewer;

  const rendering = createRendering({ state });
  const interaction = createInteraction({ state });
  rendering.prepareReferenceCollections(viewer);
  const featureRecord = {
    id: 'cable/17',
    featureId: 'cable/17',
    identity: 'cable:cable/17',
    kind: 'cable',
    reference: { lon: 0, lat: 0 },
    label: 'Cable 17',
  };
  rendering.addReferenceStem({
    reference: { lon: 0, lat: 0 },
    label: 'Cable 17',
    kind: 'cable',
    color: state.cableColor,
    featureRecord,
  });

  const record = state._referenceRecords[0];
  const metadataEntity = record.entity;
  const { points, stems } = state._referenceCollections;
  assert.ok(points instanceof Cesium.PointPrimitiveCollection);
  assert.ok(stems instanceof Cesium.PolylineCollection);
  assert.equal(scenePrimitives.length, 2);
  assert.equal(points.length, 1);
  assert.equal(stems.length, 1);
  assert.equal(metadataEntity.id, 'cable-reference-0-cable/17');
  assert.equal(metadataEntity.point, undefined);
  assert.equal(metadataEntity.polyline, undefined);
  assert.equal(record.pointPrimitive.id, metadataEntity);
  assert.equal(record.polylinePrimitive.id, metadataEntity);
  assert.equal(points.blendOption, Cesium.BlendOption.TRANSLUCENT);
  assert.equal(record.pointPrimitive.pixelSize, 7);
  assert.equal(record.pointPrimitive.outlineWidth, 1);
  assert.equal(record.pointPrimitive.disableDepthTestDistance, 0);
  assert.equal(record.polylinePrimitive.width, 2);

  const expectedStemColor = Cesium.Color.fromBytes(
    ...state.cableColor.withAlpha(0.58).toBytes(),
  );
  assert.ok(
    Cesium.Color.equals(
      record.polylinePrimitive.material.uniforms.color,
      expectedStemColor,
    ),
    'collection stem material uses the same RGBA8 encoding as static Entity geometry',
  );

  assert.equal(state._pickByEntity.get(metadataEntity), featureRecord);
  assert.equal(state._pickByEntity.get(record.pointPrimitive), featureRecord);
  assert.equal(
    state._pickByEntity.get(record.polylinePrimitive),
    featureRecord,
  );
  assert.equal(
    interaction.resolvePickRecord({
      primitive: record.pointPrimitive,
      id: metadataEntity,
    }),
    featureRecord,
  );
  assert.equal(
    interaction.resolvePickRecord({
      primitive: record.polylinePrimitive,
      id: metadataEntity,
    }),
    featureRecord,
  );

  rendering.updateReferenceVisibility();
  assert.equal(record.visible, true);
  assert.equal(record.pointPrimitive.show, true);
  assert.equal(record.polylinePrimitive.show, true);
  const firstTip = Cesium.Cartesian3.clone(record.tip);

  viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(0, 0, 100_000);
  rendering.updateReferenceVisibility();
  assert.equal(record.visible, true);
  assert.ok(Cesium.Cartesian3.distance(record.tip, firstTip) > 1);
  assert.ok(
    Cesium.Cartesian3.equals(record.polylinePrimitive.positions[1], record.tip),
  );

  viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(180, 0, 8_000);
  rendering.updateReferenceVisibility();
  assert.equal(record.visible, false);
  assert.equal(record.pointPrimitive.show, false);
  assert.equal(record.polylinePrimitive.show, false);

  state._enabled = false;
  rendering.updateVisibility();
  assert.equal(points.show, false);
  assert.equal(stems.show, false);
  state._enabled = true;
  rendering.updateVisibility();
  assert.equal(points.show, true);
  assert.equal(stems.show, true);

  const stalePoint = record.pointPrimitive;
  const stalePointsCollection = points;
  const staleStemsCollection = stems;
  scenePrimitives.destroyPrimitives = false;
  rendering.releaseDataSources(viewer);
  assert.equal(scenePrimitives.length, 0);
  assert.equal(state._referenceCollections, null);
  assert.equal(stalePointsCollection.isDestroyed(), true);
  assert.equal(staleStemsCollection.isDestroyed(), true);
  assert.equal(removedDataSources.length, 1);
  assert.equal(interaction.resolvePickRecord({ primitive: stalePoint }), null);
  state._referenceDataSource = new Cesium.CustomDataSource('reference retry');
  rendering.prepareReferenceCollections(viewer);
  rendering.addReferenceStem({
    reference: { lon: 0, lat: 0 },
    label: 'Cable 17',
    kind: 'cable',
    color: state.cableColor,
    featureRecord: {
      id: 'cable/17',
      featureId: 'cable/17',
      identity: 'cable:cable/17',
      kind: 'cable',
      reference: { lon: 0, lat: 0 },
      label: 'Cable 17',
    },
  });
  assert.equal(scenePrimitives.length, 2);
  assert.equal(state._referenceCollections.points.length, 1);
  rendering.releaseDataSources(viewer);
  assert.equal(scenePrimitives.length, 0);
});

test('partial reference collection attachment rolls back and can be retried', () => {
  const state = createState({
    sweepClock: () => 0,
    overlayHost: overlayHost(),
    referenceRenderer: 'collections',
  });
  const scenePrimitives = new Cesium.PrimitiveCollection();
  const originalAdd = scenePrimitives.add.bind(scenePrimitives);
  const attempted = [];
  let addCount = 0;
  scenePrimitives.add = (primitive) => {
    addCount += 1;
    attempted.push(primitive);
    if (addCount === 2) throw new Error('stem collection attach failed');
    return originalAdd(primitive);
  };
  const viewer = { scene: { primitives: scenePrimitives } };
  const rendering = createRendering({ state });

  assert.throws(
    () => rendering.prepareReferenceCollections(viewer),
    /stem collection attach failed/,
  );
  assert.equal(scenePrimitives.length, 0);
  assert.equal(state._referenceCollections, null);
  assert.equal(attempted.length, 2);
  assert.ok(attempted.every((collection) => collection.isDestroyed()));

  scenePrimitives.add = originalAdd;
  rendering.prepareReferenceCollections(viewer);
  assert.equal(scenePrimitives.length, 2);
  rendering.releaseReferenceCollections();
  assert.equal(scenePrimitives.length, 0);

  const unattachedState = createState({
    sweepClock: () => 0,
    overlayHost: overlayHost(),
    referenceRenderer: 'collections',
  });
  const unattachedPrimitives = new Cesium.PrimitiveCollection();
  const unattachedViewer = { scene: { primitives: unattachedPrimitives } };
  let unattachedPoints;
  unattachedPrimitives.add = (collection) => {
    unattachedPoints = collection;
    throw new Error('point collection attach failed');
  };
  assert.throws(
    () =>
      createRendering({ state: unattachedState }).prepareReferenceCollections(
        unattachedViewer,
      ),
    /point collection attach failed/,
  );
  assert.equal(unattachedPrimitives.length, 0);
  assert.equal(unattachedPoints.isDestroyed(), true);
});

test('collection references release on disable, rebuild on re-enable, and destroy cleanly', async (t) => {
  for (const name of [
    'HTMLCanvasElement',
    'HTMLImageElement',
    'ImageBitmap',
    'OffscreenCanvas',
  ]) {
    const previous = globalThis[name];
    globalThis[name] = class {};
    t.after(() => {
      if (previous === undefined) delete globalThis[name];
      else globalThis[name] = previous;
    });
  }
  const previousDocument = globalThis.document;
  const context2D = {
    save() {},
    scale() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    restore() {},
  };
  globalThis.document = {
    createElement() {
      return { getContext: () => context2D };
    },
  };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });

  const source = {
    label: 'lifecycle fixture',
    async fetch() {
      return {
        cables: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'cable-lifecycle',
              properties: { id: 'cable-lifecycle', name: 'Cable lifecycle' },
              geometry: {
                type: 'LineString',
                coordinates: [
                  [0, 0],
                  [1, 1],
                ],
              },
            },
          ],
        },
        landingPoints: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'landing-lifecycle',
              properties: {
                id: 'landing-lifecycle',
                name: 'Landing lifecycle',
              },
              geometry: { type: 'Point', coordinates: [0, 0] },
            },
          ],
        },
      };
    },
  };
  const dataSources = new Set();
  const scenePrimitives = new Cesium.PrimitiveCollection();
  const viewer = {
    scene: {
      primitives: scenePrimitives,
      preRender: new Cesium.Event(),
      canvas: { clientHeight: 800 },
      globe: { show: true },
      requestRender() {},
    },
    camera: {
      moveEnd: new Cesium.Event(),
      positionWC: Cesium.Cartesian3.fromDegrees(0, 0, 8000),
      frustum: { fov: Math.PI / 3 },
    },
    dataSources: {
      async add(dataSource) {
        dataSources.add(dataSource);
        return dataSource;
      },
      remove(dataSource) {
        return dataSources.delete(dataSource);
      },
    },
  };
  const layer = createSubmarineCableLayer({
    source,
    overlayHost: overlayHost(),
    screenSpaceEventHandlerFactory: () => ({
      setInputAction() {},
      destroy() {},
    }),
    referenceRenderer: 'collections',
  });
  const waitForLoad = async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (!layer.getStats().loading && layer.getStats().count > 0) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error('reference layer did not finish loading');
  };

  try {
    layer.init(viewer);
    layer.enable(viewer);
    await waitForLoad();
    assert.equal(layer.getPerformanceDiagnostics().referencePointPrimitives, 2);
    assert.equal(layer.getPerformanceDiagnostics().referenceStemPrimitives, 2);
    assert.equal(scenePrimitives.length, 2);

    layer.disable();
    assert.equal(layer.getPerformanceDiagnostics().referenceCollections, 0);
    assert.equal(layer.getPerformanceDiagnostics().referencePointPrimitives, 0);
    assert.equal(layer.getPerformanceDiagnostics().referenceStemPrimitives, 0);
    assert.equal(scenePrimitives.length, 0);
    assert.equal(dataSources.size, 0);

    layer.enable(viewer);
    await waitForLoad();
    assert.equal(layer.getPerformanceDiagnostics().referencePointPrimitives, 2);
    assert.equal(layer.getPerformanceDiagnostics().referenceStemPrimitives, 2);
    assert.equal(scenePrimitives.length, 2);

    layer.destroy(viewer);
    assert.equal(layer.getPerformanceDiagnostics().referenceCollections, 0);
    assert.equal(scenePrimitives.length, 0);
    assert.equal(dataSources.size, 0);
    assert.equal(layer.getPerformanceDiagnostics().listeners, 0);
  } finally {
    layer.destroy(viewer);
  }
});

test('bundled collection mode owns all cable and landing references without visual Entities', async (t) => {
  for (const name of [
    'HTMLCanvasElement',
    'HTMLImageElement',
    'ImageBitmap',
    'OffscreenCanvas',
  ]) {
    const previous = globalThis[name];
    globalThis[name] = class {};
    t.after(() => {
      if (previous === undefined) delete globalThis[name];
      else globalThis[name] = previous;
    });
  }
  const previousDocument = globalThis.document;
  const context2D = {
    save() {},
    scale() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    restore() {},
  };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext(kind) {
          assert.equal(kind, '2d');
          return context2D;
        },
      };
    },
  };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const readData = (name) =>
    JSON.parse(
      readFileSync(
        new URL(
          `../../data/local_data/telegeography_submarine_cables/${name}`,
          import.meta.url,
        ),
        'utf8',
      ),
    );
  const cables = readData('cable-geo.json');
  const landings = readData('landing-point-geo.json');
  const state = createState({
    sweepClock: () => 0,
    overlayHost: overlayHost(),
    referenceRenderer: 'collections',
  });
  state._enabled = true;
  const parts = {
    rendering: createRendering({ state }),
    interaction: createInteraction({ state }),
  };
  const attached = new Set();
  const scenePrimitives = new Cesium.PrimitiveCollection();
  const viewer = {
    scene: { primitives: scenePrimitives, requestRender() {} },
    dataSources: {
      async add(dataSource) {
        attached.add(dataSource);
        return dataSource;
      },
      remove(dataSource) {
        return attached.delete(dataSource);
      },
    },
  };
  const oldWarn = console.warn;
  console.warn = () => {};
  try {
    await createIngestion({
      state,
      parts,
      source: {
        label: 'bundled reference collection fixture',
        async fetch() {
          return { cables, landingPoints: landings };
        },
      },
    }).load(viewer);

    assert.equal(state._error, null);
    assert.equal(state._featureRecords.length, 2629);
    assert.equal(state._referenceRecords.length, 2629);
    assert.equal(state._surfaceRecords.length, 3830);
    assert.equal(state._cableDataSource.entities.values.length, 1913);
    assert.equal(state._landingDataSource.entities.values.length, 1917);
    assert.equal(state._referenceDataSource.entities.values.length, 2629);
    assert.equal(state._referenceCollections.points.length, 2629);
    assert.equal(state._referenceCollections.stems.length, 2629);
    assert.equal(scenePrimitives.length, 2);
    assert.ok(
      state._landingDataSource.entities.values.every(
        (entity) => entity.billboard && !entity.point,
      ),
      'ground-clamped GeoJSON landing points remain PinBuilder billboard Entities',
    );
    assert.equal(
      state._landingDataSource.entities.values[0].billboard.heightReference.getValue(
        Cesium.JulianDate.MINIMUM_VALUE,
      ),
      Cesium.HeightReference.CLAMP_TO_GROUND,
    );
    assert.equal(
      state._cableDataSource.entities.values[0].polyline.clampToGround.getValue(),
      true,
      'all 1,913 cable surface segments remain on the ground-polyline path',
    );
    assert.ok(
      state._referenceDataSource.entities.values.every(
        (entity) => !entity.billboard && !entity.point && !entity.polyline,
      ),
      'metadata Entities do not create duplicate visualizer graphics',
    );
    for (const reference of state._referenceRecords) {
      assert.equal(reference.pointPrimitive.id, reference.entity);
      assert.equal(reference.polylinePrimitive.id, reference.entity);
      assert.equal(
        state._pickByEntity.get(reference.pointPrimitive),
        state._pickByEntity.get(reference.entity),
      );
      assert.equal(
        state._pickByEntity.get(reference.polylinePrimitive),
        state._pickByEntity.get(reference.entity),
      );
    }
    const cableReference = state._referenceRecords.find(
      (reference) => reference.kind === 'cable',
    );
    const landingReference = state._referenceRecords.find(
      (reference) => reference.kind === 'landing-point',
    );
    assert.ok(cableReference && landingReference);
    assert.equal(cableReference.pointPrimitive.pixelSize, 7);
    assert.equal(cableReference.polylinePrimitive.width, 2);
    assert.ok(
      Cesium.Color.equals(
        cableReference.pointPrimitive.color,
        state.cableColor.withAlpha(0.84),
      ),
    );
    assert.ok(
      Cesium.Color.equals(
        cableReference.polylinePrimitive.material.uniforms.color,
        Cesium.Color.fromBytes(...state.cableColor.withAlpha(0.58).toBytes()),
      ),
    );
    assert.equal(landingReference.pointPrimitive.pixelSize, 8);
    assert.equal(landingReference.polylinePrimitive.width, 2.4);
    assert.ok(
      Cesium.Color.equals(
        landingReference.pointPrimitive.color,
        state.landingColor.withAlpha(0.94),
      ),
    );
    assert.ok(
      Cesium.Color.equals(
        landingReference.polylinePrimitive.material.uniforms.color,
        Cesium.Color.fromBytes(...state.landingColor.withAlpha(0.68).toBytes()),
      ),
    );
    const first = state._referenceRecords[0];
    const mapped = parts.interaction.resolvePickRecord({
      id: first.entity,
      primitive: first.pointPrimitive,
    });
    assert.equal(mapped, state._featureRecords[0]);

    parts.rendering.releaseDataSources(viewer);
    assert.equal(attached.size, 0);
    assert.equal(scenePrimitives.length, 0);
    assert.equal(state._referenceCollections, null);
    assert.equal(state._referenceRecords.length, 0);
    assert.equal(state._featureRecords.length, 0);
  } finally {
    console.warn = oldWarn;
    if (state._referenceCollections) parts.rendering.releaseDataSources(viewer);
  }
});
