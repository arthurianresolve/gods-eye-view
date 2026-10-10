import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createRendering } from './rendering.js';
import {
  ACTIVE_COVERAGE_CENTER,
  ACTIVE_COVERAGE_CENTER_DEPTHFAIL,
  ACTIVE_COVERAGE_EDGE,
  ACTIVE_COVERAGE_EDGE_DEPTHFAIL,
  IDLE_COVERAGE_CENTER_MUTED,
  IDLE_COVERAGE_EDGE_MUTED,
} from './policy.js';

function createUpdaterFixture() {
  const record = {
    camera: { id: 'camera-a', headingConfidence: 'low' },
    coverageEntities: Array.from({ length: 5 }, (_, index) => {
      const entity = new Cesium.Entity({
        id: `camera-a-coverage-${index}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray([
            -97.7431, 30.2672, -97.742, 30.268,
          ]),
          material: Cesium.Color.WHITE,
          width: 1,
        },
      });
      entity._coverageRole = index === 4 ? 'cap' : 'ray';
      return entity;
    }),
  };
  let activeRecord = record;
  const state = {
    _records: [record],
    _enabled: true,
    _coverageMode: 'frustum',
    _showProjection: true,
    _activeCameraId: record.camera.id,
  };
  const rendering = createRendering({
    state,
    services: { focus: {} },
    parts: {
      selection: { getActiveRecord: () => activeRecord },
      geometry: {
        ensureActiveCoverageEntities() {},
        buildCoverageVisibleSet: () => new Set([record.camera.id]),
        ensureVisibleCoverageEntities() {},
      },
      model: { isVideoFeedType: () => false },
      projection: {
        ensureProjectionRuntime() {},
        pauseInactiveProjectionFeeds() {},
        setPlaneVisible() {},
      },
    },
  });
  const updaters = record.coverageEntities.map(
    (entity) =>
      new Cesium.PolylineGeometryUpdater(entity, {
        frameState: { context: { depthTexture: true } },
      }),
  );
  let geometryChanges = 0;
  const removers = updaters.map((updater) =>
    updater.geometryChanged.addEventListener(() => geometryChanges++),
  );
  return {
    record,
    state,
    rendering,
    setActiveRecord(value) {
      activeRecord = value;
    },
    geometryChangeCount: () => geometryChanges,
    dispose() {
      removers.forEach((remove) => remove());
      updaters.forEach((updater) => updater.destroy());
    },
  };
}

test('unchanged CCTV coverage refreshes do not invalidate Cesium polyline geometry', (t) => {
  const fixture = createUpdaterFixture();
  t.after(() => fixture.dispose());
  fixture.rendering.refreshCoverageStyles();
  const baseline = fixture.geometryChangeCount();

  for (let index = 0; index < 5; index++)
    fixture.rendering.refreshCoverageStyles();

  assert.equal(fixture.geometryChangeCount(), baseline);
});

test('coverage refresh still updates estimated, active, viewshed, and projection styles', (t) => {
  const fixture = createUpdaterFixture();
  t.after(() => fixture.dispose());
  fixture.rendering.refreshCoverageStyles();
  assert.ok(
    fixture.record.coverageEntities.every(
      (entity) =>
        entity.polyline.material instanceof Cesium.PolylineDashMaterialProperty,
    ),
  );
  let previous = fixture.geometryChangeCount();
  const colorAt = (entity, property = 'material') =>
    entity.polyline[property]?.color?.getValue(Cesium.JulianDate.now()) || null;
  const assertStableAfterChange = (label) => {
    const changed = fixture.geometryChangeCount();
    assert.ok(changed > previous, `${label} must invalidate the changed style`);
    previous = changed;
    fixture.rendering.refreshCoverageStyles();
    assert.equal(
      fixture.geometryChangeCount(),
      previous,
      `${label} must settle without repeat geometry invalidation`,
    );
  };
  const expectStyleChange = (label) => {
    fixture.rendering.refreshCoverageStyles();
    assertStableAfterChange(label);
  };

  const ray = fixture.record.coverageEntities[0];
  const cap = fixture.record.coverageEntities[4];
  assert.ok(Cesium.Color.equals(colorAt(ray), ACTIVE_COVERAGE_EDGE));
  assert.ok(Cesium.Color.equals(colorAt(cap), ACTIVE_COVERAGE_CENTER));
  assert.equal(ray.polyline.width.getValue(Cesium.JulianDate.now()), 1.8);
  assert.equal(cap.polyline.width.getValue(Cesium.JulianDate.now()), 2.2);
  assert.ok(
    Cesium.Color.equals(
      colorAt(ray, 'depthFailMaterial'),
      ACTIVE_COVERAGE_EDGE_DEPTHFAIL,
    ),
  );
  assert.ok(
    Cesium.Color.equals(
      colorAt(cap, 'depthFailMaterial'),
      ACTIVE_COVERAGE_CENTER_DEPTHFAIL,
    ),
  );
  assert.equal(ray.polyline.material.dashLength, undefined);
  assert.equal(ray.polyline.material.dashPattern, undefined);

  fixture.record.camera.poseSource = 'curated';
  expectStyleChange('curated bearing removes estimated dashes');
  assert.ok(
    fixture.record.coverageEntities.every(
      (entity) =>
        entity.polyline.material instanceof Cesium.ColorMaterialProperty,
    ),
  );
  assert.ok(Cesium.Color.equals(colorAt(ray), ACTIVE_COVERAGE_EDGE));

  fixture.record.camera.poseSource = null;
  expectStyleChange('estimated bearing restores dashes');
  assert.ok(
    fixture.record.coverageEntities.every(
      (entity) =>
        entity.polyline.material instanceof Cesium.PolylineDashMaterialProperty,
    ),
  );
  assert.ok(Cesium.Color.equals(colorAt(ray), ACTIVE_COVERAGE_EDGE));

  fixture.setActiveRecord(null);
  fixture.state._activeCameraId = null;
  expectStyleChange('active-to-idle transition');
  assert.ok(Cesium.Color.equals(colorAt(ray), IDLE_COVERAGE_EDGE_MUTED));
  assert.ok(Cesium.Color.equals(colorAt(cap), IDLE_COVERAGE_CENTER_MUTED));
  assert.equal(cap.polyline.width.getValue(Cesium.JulianDate.now()), 1);
  assert.equal(colorAt(ray, 'depthFailMaterial'), null);
  assert.equal(colorAt(cap, 'depthFailMaterial'), null);

  fixture.record.viewshedColors = {
    line: Cesium.Color.ORANGE,
    lineActive: Cesium.Color.YELLOW,
  };
  fixture.setActiveRecord(fixture.record);
  fixture.state._activeCameraId = fixture.record.camera.id;
  fixture.state._coverageMode = 'viewshed';
  expectStyleChange('viewshed material colors');
  assert.ok(Cesium.Color.equals(colorAt(ray), Cesium.Color.YELLOW));
  assert.ok(Cesium.Color.equals(colorAt(cap), Cesium.Color.YELLOW));
  assert.ok(
    Cesium.Color.equals(
      colorAt(ray, 'depthFailMaterial'),
      Cesium.Color.ORANGE.withAlpha(0.18),
    ),
  );
  assert.ok(
    Cesium.Color.equals(
      colorAt(cap, 'depthFailMaterial'),
      Cesium.Color.ORANGE.withAlpha(0.26),
    ),
  );

  fixture.state._showProjection = false;
  expectStyleChange('projection toggle removes depth-fail materials');
  assert.equal(colorAt(ray, 'depthFailMaterial'), null);
  assert.equal(colorAt(cap, 'depthFailMaterial'), null);

  fixture.state._showProjection = true;
  expectStyleChange('projection toggle restores depth-fail materials');
});

test('coverage refresh replaces dynamic colors and custom estimated dash parameters', (t) => {
  const fixture = createUpdaterFixture();
  t.after(() => fixture.dispose());
  fixture.rendering.refreshCoverageStyles();
  const ray = fixture.record.coverageEntities[0];
  const currentColor = ray.polyline.material.color.getValue(
    Cesium.JulianDate.now(),
  );
  ray.polyline.material = new Cesium.PolylineDashMaterialProperty({
    color: new Cesium.CallbackProperty(() => currentColor, false),
  });
  const beforeDynamicReplacement = fixture.geometryChangeCount();
  fixture.rendering.refreshCoverageStyles();
  assert.ok(fixture.geometryChangeCount() > beforeDynamicReplacement);
  assert.ok(ray.polyline.material.color instanceof Cesium.ConstantProperty);

  ray.polyline.material = new Cesium.PolylineDashMaterialProperty({
    color: currentColor,
    dashLength: 3,
  });
  const beforeCustomDashReplacement = fixture.geometryChangeCount();
  fixture.rendering.refreshCoverageStyles();
  assert.ok(fixture.geometryChangeCount() > beforeCustomDashReplacement);
  assert.equal(ray.polyline.material.dashLength, undefined);
});
