import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createGeometry } from '../../../src/layers/cctv/geometry.js';
import { createRendering } from '../../../src/layers/cctv/rendering.js';
import { viewshedColors } from '../../../src/data/cctvViewshed.js';

// Isolate volume ownership with real production create/remove paths and actual
// Cesium primitives. No browser/GPU, terrain or wireframe performance is claimed.
const primitives = new Cesium.PrimitiveCollection();
const record = {
  camera: { id: 'ownership-fixture', lat: 30.2, lon: -97.7 },
  coverageEntities: [],
  frustumPositions: {
    mount: Cesium.Cartesian3.fromDegrees(-97.7, 30.2, 50),
    tl: Cesium.Cartesian3.fromDegrees(-97.699, 30.201, 60),
    tr: Cesium.Cartesian3.fromDegrees(-97.698, 30.201, 60),
    br: Cesium.Cartesian3.fromDegrees(-97.698, 30.201, 30),
    bl: Cesium.Cartesian3.fromDegrees(-97.699, 30.201, 30),
  },
  viewshedColors: viewshedColors(120),
};
const state = {
  _enabled: true,
  _coverageMode: 'viewshed',
  _activeCameraId: record.camera.id,
  _records: [record],
  _viewer: { scene: { primitives } },
};
const parts = {
  model: { isVideoFeedType: () => false },
  selection: { getActiveRecord: () => record },
  projection: {
    clearProjectionOverlay() {},
    pauseInactiveProjectionFeeds() {},
  },
};
const services = { ground: {}, mesh: {}, focus: {} };
parts.geometry = createGeometry({ state, services, parts, source: {} });
// This diagnostic owns volume lifetime; unrelated coverage entity construction
// is excluded, so it cannot make an assertion about wireframe worker counts.
parts.geometry.ensureVisibleCoverageEntities = () => {};
parts.geometry.ensureActiveCoverageEntities = () => {};
parts.geometry.buildCoverageVisibleSet = () => new Set([record.camera.id]);
const rendering = createRendering({ state, services, parts, source: {} });
const originalPositions = record.frustumPositions;
const cycles = [];
try {
  rendering.refreshCoverageStyles();
  for (let cycle = 1; cycle <= 3; cycle++) {
    const before = record.viewshedPrimitive;
    assert.ok(before instanceof Cesium.Primitive);
    assert.equal(primitives.length, 1);
    state._enabled = false;
    rendering.hideCctvVisuals();
    assert.equal(before.isDestroyed(), true);
    assert.equal(record.viewshedPrimitive, null);
    assert.equal(primitives.length, 0);
    state._enabled = true;
    rendering.refreshCoverageStyles();
    assert.notEqual(record.viewshedPrimitive, before);
    assert.equal(record.frustumPositions, originalPositions);
    assert.equal(primitives.length, 1);
    cycles.push({
      cycle,
      oldPrimitiveDestroyed: true,
      replacementCreated: true,
      unchangedPositions: true,
      livePrimitivesAfterReenable: primitives.length,
    });
  }
} finally {
  primitives.destroy();
}
assert.equal(primitives.isDestroyed(), true);
console.log(
  JSON.stringify(
    {
      scope:
        'Production volume ownership CPU reproduction; no rendered evidence',
      status: 'unchanged-visibility-rebuild-gap-confirmed',
      initialPrimitiveCount: 1,
      additionalPrimitiveConstructions: cycles.length,
      cycles,
      ownedCollectionDestroyed: true,
    },
    null,
    2,
  ),
);
