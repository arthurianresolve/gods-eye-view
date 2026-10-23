import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { viewshedColors } from '../../data/cctvViewshed.js';
import { createGeometry } from './geometry.js';
import { createRendering } from './rendering.js';
import {
  ACTIVE_COVERAGE_CENTER,
  ACTIVE_COVERAGE_CENTER_DEPTHFAIL,
  ACTIVE_COVERAGE_EDGE,
  ACTIVE_COVERAGE_EDGE_DEPTHFAIL,
  ACTIVE_CAMERA_COLOR,
  IDLE_COVERAGE_CENTER_MUTED,
  IDLE_COVERAGE_EDGE_MUTED,
  IDLE_CAMERA_COLOR,
  LIVE_CAMERA_COLOR,
} from './policy.js';
import { isVideoFeedType } from '../../sources/cctvTypes.js';

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

test('viewshed toggles reuse the bounded current cohort and evict before admitting another', () => {
  const records = Array.from({ length: 16 }, (_, index) => ({
    camera: { id: `camera-${index}`, headingConfidence: 'high' },
    coverageEntities: [],
    frustumPositions: {},
    viewshedColors: {},
    viewshedPrimitive: null,
    viewshedActiveTint: null,
  }));
  const state = {
    _records: records,
    _enabled: true,
    _coverageMode: 'viewshed',
    _showProjection: false,
    _activeCameraId: records[0].camera.id,
    _billboards: null,
  };
  let activeRecord = records[0];
  let visibleIds = new Set(records.slice(0, 14).map(({ camera }) => camera.id));
  const events = [];
  const rendering = createRendering({
    state,
    services: { focus: {} },
    parts: {
      selection: { getActiveRecord: () => activeRecord },
      geometry: {
        ensureActiveCoverageEntities() {},
        buildCoverageVisibleSet: () => visibleIds,
        ensureVisibleCoverageEntities() {},
        rebuildViewshedVolume(record, active) {
          record.viewshedPrimitive = { show: true, active };
          record.viewshedActiveTint = active;
          events.push(['create', record.camera.id]);
        },
        hideViewshedVolume(record) {
          record.viewshedPrimitive.show = false;
        },
        destroyViewshedVolume(record) {
          events.push(['destroy', record.camera.id]);
          record.viewshedPrimitive = null;
          record.viewshedActiveTint = null;
        },
        updateViewshedVolumeTint(record, active) {
          record.viewshedPrimitive.active = active;
          record.viewshedActiveTint = active;
          events.push(['tint', record.camera.id]);
          return true;
        },
      },
      model: { isVideoFeedType: () => false },
      projection: {
        ensureProjectionRuntime() {},
        pauseInactiveProjectionFeeds() {},
        clearProjectionOverlay() {},
        setPlaneVisible() {},
      },
    },
  });

  rendering.refreshCoverageStyles();
  const firstCohort = records
    .slice(0, 14)
    .map((record) => record.viewshedPrimitive);
  assert.equal(firstCohort.filter(Boolean).length, 14);
  assert.equal(records[14].viewshedPrimitive, null);
  assert.equal(records[15].viewshedPrimitive, null);

  rendering.hideCctvVisuals();
  assert.deepEqual(
    records.slice(0, 14).map((record) => record.viewshedPrimitive.show),
    Array(14).fill(false),
  );
  state._enabled = true;
  rendering.refreshCoverageStyles();
  assert.deepEqual(
    records.slice(0, 14).map((record) => record.viewshedPrimitive),
    firstCohort,
    'same-cohort re-entry reuses every hidden primitive',
  );

  state._coverageMode = 'on';
  rendering.refreshCoverageStyles();
  assert.deepEqual(
    records.slice(0, 14).map((record) => record.viewshedPrimitive.show),
    Array(14).fill(false),
    'wireframe mode hides but retains the same bounded viewshed cohort',
  );
  state._coverageMode = 'off';
  rendering.refreshCoverageStyles();
  assert.deepEqual(
    records.slice(0, 14).map((record) => record.viewshedPrimitive),
    firstCohort,
    'coverage-off mode does not discard the retained current cohort',
  );
  state._coverageMode = 'viewshed';
  rendering.refreshCoverageStyles();
  assert.deepEqual(
    records.slice(0, 14).map((record) => record.viewshedPrimitive),
    firstCohort,
    'viewshed mode reuses the original primitives after mode round-trips',
  );

  events.length = 0;
  visibleIds = new Set(records.slice(2, 16).map(({ camera }) => camera.id));
  rendering.refreshCoverageStyles();
  assert.equal(records.filter((record) => record.viewshedPrimitive).length, 14);
  assert.equal(records[0].viewshedPrimitive, null);
  assert.equal(records[1].viewshedPrimitive, null);
  assert.ok(
    events.findIndex(([kind, id]) => kind === 'destroy' && id === 'camera-0') <
      events.findIndex(([kind, id]) => kind === 'create' && id === 'camera-14'),
  );

  const beforeActiveChange = events.filter(
    ([kind]) => kind === 'create',
  ).length;
  activeRecord = records[3];
  state._activeCameraId = records[3].camera.id;
  rendering.refreshCoverageStyles();
  assert.equal(
    events.filter(([kind]) => kind === 'create').length,
    beforeActiveChange,
    'active tint changes update retained instances instead of rebuilding geometry',
  );
  assert.equal(records[3].viewshedPrimitive.active, true);
  assert.equal(records[2].viewshedPrimitive.active, false);
});

test('production geometry owns retained viewshed primitives through mode changes, cohort replacement, and teardown', () => {
  const primitives = new Cesium.PrimitiveCollection();
  const records = Array.from({ length: 16 }, (_, index) => ({
    camera: {
      id: `owned-camera-${index}`,
      headingConfidence: 'high',
    },
    coverageEntities: [],
    frustumPositions: {
      mount: Cesium.Cartesian3.fromDegrees(-97.7, 30.2, 50),
      tl: Cesium.Cartesian3.fromDegrees(-97.699, 30.201, 60),
      tr: Cesium.Cartesian3.fromDegrees(-97.698, 30.201, 60),
      br: Cesium.Cartesian3.fromDegrees(-97.698, 30.201, 30),
      bl: Cesium.Cartesian3.fromDegrees(-97.699, 30.201, 30),
    },
    viewshedColors: viewshedColors(index * 17),
    viewshedPrimitive: null,
    viewshedPrimitiveInstanceId: null,
    viewshedActiveTint: null,
  }));
  const state = {
    _records: records,
    _coverageEntities: [],
    _projectionEntities: [],
    _enabled: true,
    _coverageMode: 'viewshed',
    _showProjection: false,
    _activeCameraId: records[0].camera.id,
    _billboards: null,
    _viewer: { scene: { primitives } },
  };
  let visibleIds = new Set(records.slice(0, 14).map(({ camera }) => camera.id));
  const activeRecord = records[0];
  const parts = {
    selection: { getActiveRecord: () => activeRecord },
    model: { isVideoFeedType: () => false },
    projection: {
      clearProjectionOverlay() {},
      pauseInactiveProjectionFeeds() {},
      ensureProjectionRuntime() {},
      setPlaneVisible() {},
    },
  };
  const services = { ground: {}, mesh: {}, focus: {} };
  parts.geometry = createGeometry({ state, services, parts, source: {} });
  parts.geometry.buildCoverageVisibleSet = () => visibleIds;
  parts.geometry.ensureActiveCoverageEntities = () => {};
  parts.geometry.ensureVisibleCoverageEntities = () => {};
  const rendering = createRendering({ state, services, parts, source: {} });

  try {
    rendering.refreshCoverageStyles();
    const firstCohort = records
      .slice(0, 14)
      .map((record) => record.viewshedPrimitive);
    assert.equal(primitives.length, 14);
    assert.ok(
      firstCohort.every((primitive) => primitive instanceof Cesium.Primitive),
    );

    state._enabled = false;
    rendering.hideCctvVisuals();
    assert.equal(primitives.length, 14);
    assert.ok(firstCohort.every((primitive) => !primitive.isDestroyed()));
    state._enabled = true;
    for (const coverageMode of ['on', 'off', 'viewshed']) {
      state._coverageMode = coverageMode;
      rendering.refreshCoverageStyles();
      assert.deepEqual(
        records.slice(0, 14).map((record) => record.viewshedPrimitive),
        firstCohort,
      );
      assert.equal(primitives.length, 14);
    }

    visibleIds = new Set(records.slice(2, 16).map(({ camera }) => camera.id));
    rendering.refreshCoverageStyles();
    assert.equal(primitives.length, 14);
    assert.equal(records[0].viewshedPrimitive, null);
    assert.equal(records[1].viewshedPrimitive, null);
    assert.ok(firstCohort[0].isDestroyed());
    assert.ok(firstCohort[1].isDestroyed());

    const remaining = records.flatMap((record) =>
      record.viewshedPrimitive ? [record.viewshedPrimitive] : [],
    );
    parts.geometry.destroyCoverageEntities();
    assert.equal(primitives.length, 0);
    assert.ok(remaining.every((primitive) => primitive.isDestroyed()));
  } finally {
    if (!primitives.isDestroyed()) primitives.destroy();
  }
  assert.equal(primitives.isDestroyed(), true);
});

const FOCUS_FACTOR = 0.5;

function assertFadedFrom(actual, base, label) {
  assert.ok(actual, `${label}: color written`);
  assert.deepEqual(
    [actual.red, actual.green, actual.blue],
    [base.red, base.green, base.blue],
    `${label}: hue`,
  );
  assert.equal(actual.alpha, base.alpha * FOCUS_FACTOR, `${label}: alpha`);
}

test('focus de-emphasis fades each icon from its own color', () => {
  const record = (id, feedType) => ({
    camera: { id, feedType },
    billboard: { show: true },
  });
  const idleVideo = record('idle-hls', 'hls');
  const idleStill = record('idle-image', 'image');
  const activeVideo = record('active-hls', 'hls');
  const state = {
    _enabled: true,
    _viewer: { scene: {}, camera: {} },
    _records: [idleVideo, idleStill, activeVideo],
    _activeCameraId: activeVideo.camera.id,
    _activeFocusStyleCount: 0,
    _lastFocusStyleAt: -Infinity,
  };
  const focus = {
    focusNowMs: (nowMs) => nowMs,
    getFocusTarget: () => ({}),
    focusPassIsNeeded: () => true,
    advanceSpriteFocus: () => ({
      factor: FOCUS_FACTOR,
      active: true,
      transitioning: false,
    }),
    focusAlphaNeedsWrite: () => true,
  };
  const { refreshCctvFocusStyles } = createRendering({
    state,
    services: { focus },
    parts: { model: { isVideoFeedType } },
    source: {},
  });

  refreshCctvFocusStyles(1000);

  assertFadedFrom(idleVideo.billboard.color, LIVE_CAMERA_COLOR, 'idle video');
  assertFadedFrom(idleStill.billboard.color, IDLE_CAMERA_COLOR, 'idle still');
  assertFadedFrom(
    activeVideo.billboard.color,
    ACTIVE_CAMERA_COLOR,
    'active video',
  );
  assert.equal(state._activeFocusStyleCount, 3);
});
