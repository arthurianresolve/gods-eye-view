import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createGeometry } from './geometry.js';
import { createModel } from './model.js';
import { createCalibration } from './calibration.js';
import { DEFAULT_CAMERA_CALIBRATION } from './policy.js';
import { poseHash, SUPPORT_KEYS } from '../../data/cctvFootprint.js';
import { viewshedColors } from '../../data/cctvViewshed.js';

function fixture() {
  const state = {};
  const services = { focus: {}, ground: {}, mesh: {} };
  let writes = 0,
    placements = 0;
  const parts = {
    ground: { currentSurfaceRegime: () => 'globe' },
    projection: {
      updatePlanePlacement() {
        placements++;
      },
    },
  };
  parts.model = createModel({ state, services, parts, source: {} });
  const geometry = createGeometry({ state, services, parts, source: {} });
  const record = {
    camera: {
      id: 'camera-one',
      lat: 40.7,
      lon: -73.9,
      headingDeg: 90,
      pitchDeg: -17,
      fovDeg: 74,
      rangeM: 700,
      mountHeightM: 24,
    },
    coverageEntities: Array.from({ length: 5 }, () => {
      let value;
      return {
        polyline: {
          get positions() {
            return value;
          },
          set positions(next) {
            writes++;
            value = next;
          },
        },
      };
    }),
  };
  return {
    record,
    geometry,
    state,
    services,
    parts,
    writes: () => writes,
    placements: () => placements,
  };
}

test('activation during an unsettled map switch defers the obstruction raycast', () => {
  const env = fixture();
  let raycasts = 0;
  env.state._viewer = {
    scene: {
      pickFromRay() {
        raycasts++;
      },
    },
  };
  env.services.mesh.reconcileMeshFloorSource = () => ({
    changed: false,
    source: null,
    pending: true,
  });

  env.geometry.runActivationObstructionProbe(env.record);
  assert.equal(raycasts, 0);
  assert.equal(env.record.probeClampPendingMapSwitch, true);

  let rewrites = 0;
  assert.equal(
    env.geometry.clearProbeClampOnDeactivation(env.record, () => rewrites++),
    false,
  );
  assert.equal(env.record.probeClampPendingMapSwitch, false);
  assert.equal(env.record.probeClampPendingSource, null);
  assert.equal(
    rewrites,
    0,
    'cancelling an unapplied probe does not rewrite geometry',
  );
});

test('unchanged camera activation and source metadata preserve materialized wire geometry', () => {
  const env = fixture();
  env.geometry.applyFrustumGeometry(env.record, 12);
  const geometry = env.record.frustumGeometry;
  const positions = env.record.frustumPositions;
  const wires = env.record.coverageEntities.map(
    (entity) => entity.polyline.positions,
  );
  for (let i = 0; i < 30; i++) {
    env.record.camera = {
      ...env.record.camera,
      name: `Updated source name ${i}`,
      lastSuccessAt: i,
    };
    env.geometry.applyFrustumGeometry(env.record, 12);
  }
  assert.equal(env.writes(), 5, 'No duplicate Cesium positions assignments');
  assert.equal(env.placements(), 1);
  assert.equal(env.record.frustumGeometry, geometry);
  assert.equal(env.record.frustumPositions, positions);
  env.record.coverageEntities.forEach((entity, index) =>
    assert.equal(entity.polyline.positions, wires[index]),
  );
});

for (const [field, value] of Object.entries({
  lat: 40.71,
  lon: -73.91,
  headingDeg: 110,
  pitchDeg: -10,
  fovDeg: 90,
  rangeM: 600,
  mountHeightM: 30,
})) {
  test(`camera ${field} revisions rebuild once and retain subsequent identical results`, () => {
    const env = fixture();
    env.geometry.applyFrustumGeometry(env.record, 12);
    const previous = env.record.frustumPositions;
    env.record.camera[field] = value;
    env.geometry.applyFrustumGeometry(env.record, 12);
    assert.notEqual(env.record.frustumPositions, previous);
    assert.equal(env.writes(), 10);
    env.geometry.applyFrustumGeometry(env.record, 12);
    assert.equal(env.writes(), 10);
    assert.equal(env.placements(), 2);
  });
}

test('terrain, probe-clamp and footprint revisions invalidate only their changed geometry', () => {
  const env = fixture();
  env.geometry.applyFrustumGeometry(env.record, 12);
  env.geometry.applyFrustumGeometry(env.record, 18);
  assert.equal(env.writes(), 10);
  env.record.probeClampRangeM = 400;
  env.geometry.applyFrustumGeometry(env.record, 18);
  assert.equal(env.writes(), 15);
  const pose = env.geometry.footprintPose(env.record);
  env.record.footprintGround = {
    poseHash: poseHash(pose),
    pose: { ...pose },
    supports: Object.fromEntries(SUPPORT_KEYS.map((key) => [key, 50])),
  };
  env.geometry.applyFrustumGeometry(env.record, 18);
  assert.equal(env.writes(), 20);
  env.geometry.applyFrustumGeometry(env.record, 18);
  assert.equal(env.writes(), 20);
  assert.equal(env.record.frustumGeometry.footprintMeasured, true);
});

test('footprint metadata refresh keeps identical rendered viewshed primitive', () => {
  const env = fixture();
  const primitives = [];
  let adds = 0;
  let removes = 0;
  env.state._activeCameraId = env.record.camera.id;
  env.state._viewer = {
    scene: {
      primitives: {
        add(primitive) {
          adds++;
          primitives.push(primitive);
          return primitive;
        },
        remove(primitive) {
          removes++;
          const index = primitives.indexOf(primitive);
          if (index >= 0) primitives.splice(index, 1);
          return index >= 0;
        },
      },
    },
  };
  env.record.viewshedColors = viewshedColors(120);

  env.geometry.applyFrustumGeometry(env.record, 0);
  assert.equal(env.record.frustumGeometry.footprintMeasured, false);
  env.geometry.rebuildViewshedVolume(env.record, true);
  const initialPrimitive = env.record.viewshedPrimitive;
  const initialGeometry = env.record.frustumGeometry;
  const initialPositions = env.record.frustumPositions;
  const initialVertices = Object.fromEntries(
    Object.entries(initialPositions).map(([key, point]) => [
      key,
      Cesium.Cartesian3.clone(point),
    ]),
  );
  const pose = env.geometry.footprintPose(env.record);

  env.record.footprintGround = {
    pose: { ...pose },
    poseHash: poseHash(pose),
    supports: Object.fromEntries(SUPPORT_KEYS.map((key) => [key, 0])),
  };
  env.geometry.applyFrustumGeometry(env.record, 0);

  assert.notEqual(env.record.frustumGeometry, initialGeometry);
  assert.equal(env.record.frustumGeometry.footprintMeasured, true);
  assert.equal(env.record.frustumPositions, initialPositions);
  assert.equal(env.record.viewshedPrimitive, initialPrimitive);
  assert.equal(adds, 1);
  assert.equal(removes, 0);
  for (const [key, point] of Object.entries(initialVertices))
    assert.ok(
      Cesium.Cartesian3.equals(env.record.frustumPositions[key], point),
    );

  env.record.footprintGround.supports = Object.fromEntries(
    SUPPORT_KEYS.map((key) => [key, 900]),
  );
  env.geometry.applyFrustumGeometry(env.record, 0);
  assert.notEqual(env.record.frustumPositions, initialPositions);
  assert.notEqual(env.record.viewshedPrimitive, initialPrimitive);
  assert.equal(adds, 2, 'Changed rendered support geometry builds once.');
  assert.equal(
    removes,
    1,
    'Changed rendered support geometry retires prior volume.',
  );

  const hiddenSourceBoundPrimitive = env.record.viewshedPrimitive;
  hiddenSourceBoundPrimitive.show = false;
  env.parts.ground.currentSurfaceRegime = () => 'google-3d';
  env.state._googleGroundSource = {};
  env.geometry.applyFrustumGeometry(env.record, 0);
  assert.equal(
    env.record.viewshedPrimitive,
    null,
    'A hidden volume is invalidated when its geometry owner changes.',
  );
  assert.equal(primitives.includes(hiddenSourceBoundPrimitive), false);
  assert.equal(removes, 2);
});

test('normalized calibration producer changes geometry once per real pose revision', () => {
  const env = fixture();
  const requests = [];
  const groundResolutions = [];
  env.services.render = {
    governorRequestRender(reason) {
      requests.push(reason);
    },
  };
  env.parts.ground.groundAltFor = () => 12;
  env.parts.geometry = env.geometry;
  env.parts.ground.resolveFootprintGround = (record) => {
    groundResolutions.push(record);
    return Promise.resolve();
  };
  env.parts.presentation = {
    notifyListenersThrottled() {},
    notifyListeners() {},
  };
  env.parts.frames = { refreshProjectionImage() {} };
  env.parts.rendering = { refreshCoverageStyles() {} };
  const context = {
    state: env.state,
    services: env.services,
    parts: env.parts,
    source: {},
  };
  env.parts.calibration = createCalibration(context);
  env.record.camera.calibration = { ...DEFAULT_CAMERA_CALIBRATION };
  env.parts.model.ensureCameraPose(env.record.camera);
  env.geometry.applyFrustumGeometry(env.record, 12);

  const revisions = [
    { headingDeg: 0.1 },
    { pitchDeg: 0.1 },
    { fovDeg: 0.1 },
    { rangeScale: 1.01 },
    { heightM: 0.1 },
    { offsetNorthM: 0.4 },
    { offsetNorthM: 0.5 },
    { offsetEastM: 0.1 },
  ];
  let previousHash = poseHash(env.geometry.footprintPose(env.record));
  let previousMountLat = env.record.camera.lat;
  let expectedWrites = 5;
  for (const [index, patch] of revisions.entries()) {
    assert.equal(
      env.parts.calibration.applyCalibrationPatch(env.record, patch, {
        transient: true,
      }),
      true,
    );
    const nextHash = poseHash(env.geometry.footprintPose(env.record));
    if (index === 6) {
      assert.equal(
        nextHash,
        previousHash,
        '0.4m and 0.5m north offsets expose the rounded-key collision',
      );
    } else {
      assert.notEqual(nextHash, previousHash);
    }
    if (index === 6) {
      assert.notEqual(
        env.record.frustumGeometry.mount.lat,
        previousMountLat,
        'geometry follows the actual pose despite rounded-key collision',
      );
    }
    previousMountLat = env.record.frustumGeometry.mount.lat;
    previousHash = nextHash;
    expectedWrites += 5;
    assert.equal(env.writes(), expectedWrites);
    const positions = env.record.frustumPositions;

    assert.equal(
      env.parts.calibration.applyCalibrationPatch(env.record, patch, {
        transient: true,
      }),
      true,
    );
    assert.equal(
      env.writes(),
      expectedWrites,
      'same normalized pose reuses geometry',
    );
    assert.equal(env.record.frustumPositions, positions);
  }

  assert.equal(
    groundResolutions.length,
    0,
    'transient drag keeps its commit boundary',
  );
  assert.equal(requests.length, revisions.length * 2);
  assert(requests.every((reason) => reason === 'cctv-calibration-drag'));
});

test('rounded shipped key cannot authorize footprint data for a calibrated pose', () => {
  const env = fixture();
  env.parts.ground.currentSurfaceRegime = () => 'google-3d';
  env.parts.ground.groundAltFor = () => 12;
  env.parts.geometry = env.geometry;
  env.parts.presentation = {
    notifyListenersThrottled() {},
    notifyListeners() {},
  };
  env.parts.frames = { refreshProjectionImage() {} };
  env.parts.rendering = { refreshCoverageStyles() {} };
  const context = {
    state: env.state,
    services: { focus: {}, render: {} },
    parts: env.parts,
    source: {},
  };
  env.parts.calibration = createCalibration(context);
  env.record.camera.lat = 40.7000006;
  env.record.camera.calibration = { ...DEFAULT_CAMERA_CALIBRATION };
  env.record.camera.basePose = {
    lat: env.record.camera.lat,
    lon: env.record.camera.lon,
    headingDeg: env.record.camera.headingDeg,
    pitchDeg: env.record.camera.pitchDeg,
    fovDeg: env.record.camera.fovDeg,
    rangeM: env.record.camera.rangeM,
    mountHeightM: env.record.camera.mountHeightM,
  };
  env.record.camera.groundHeights = {
    mountGroundM: 12,
    poseHash: poseHash(env.record.camera.basePose),
    supports: Object.fromEntries(SUPPORT_KEYS.map((key) => [key, 50])),
  };
  env.parts.model.ensureCameraPose(env.record.camera);

  assert.equal(env.geometry.hasShippedFootprint(env.record), true);
  assert.equal(
    env.parts.calibration.applyCalibrationPatch(
      env.record,
      { offsetNorthM: 0.1 },
      { transient: true },
    ),
    true,
  );
  assert.equal(
    poseHash(env.geometry.footprintPose(env.record)),
    env.record.camera.groundHeights.poseHash,
    'the source-compatible rounded sidecar key collides at this base pose',
  );
  assert.equal(
    env.geometry.hasShippedFootprint(env.record),
    false,
    'exact base-pose ownership rejects calibrated sidecar reuse',
  );
  assert.equal(
    env.parts.calibration.applyCalibrationPatch(
      env.record,
      { offsetNorthM: 0 },
      { transient: true },
    ),
    true,
  );
  assert.equal(
    env.geometry.hasShippedFootprint(env.record),
    true,
    'returning to the exact base pose restores shipped precompute eligibility',
  );
});

test('rounded-equal runtime DEM support is not applied to the newer pose', () => {
  const env = fixture();
  env.parts.ground.groundAltFor = () => 12;
  env.parts.geometry = env.geometry;
  env.parts.presentation = {
    notifyListenersThrottled() {},
    notifyListeners() {},
  };
  env.parts.frames = { refreshProjectionImage() {} };
  env.parts.rendering = { refreshCoverageStyles() {} };
  const context = {
    state: env.state,
    services: { focus: {}, render: {} },
    parts: env.parts,
    source: {},
  };
  env.parts.calibration = createCalibration(context);
  env.record.camera.calibration = { ...DEFAULT_CAMERA_CALIBRATION };
  env.parts.model.ensureCameraPose(env.record.camera);

  env.parts.calibration.applyCalibrationPatch(
    env.record,
    { offsetNorthM: 0.4 },
    { transient: true },
  );
  const sampledPose = env.geometry.footprintPose(env.record);
  const sampledHash = poseHash(sampledPose);
  env.record.footprintGround = {
    poseHash: sampledHash,
    pose: { ...sampledPose },
    supports: Object.fromEntries(SUPPORT_KEYS.map((key) => [key, 900])),
    provisional: false,
  };
  env.geometry.applyFrustumGeometry(env.record, 12);
  assert.equal(env.record.frustumGeometry.footprintMeasured, true);

  env.parts.calibration.applyCalibrationPatch(
    env.record,
    { offsetNorthM: 0.5 },
    { transient: true },
  );
  assert.equal(poseHash(env.geometry.footprintPose(env.record)), sampledHash);
  assert.equal(
    env.record.frustumGeometry.footprintMeasured,
    false,
    'exact runtime pose ownership rejects support heights for the prior pose',
  );
});

test('hidden cached viewshed geometry is invalidated on pose or terrain changes and tint waits for Cesium readiness', () => {
  const env = fixture();
  const primitives = [];
  const postRenderListeners = new Set();
  const renderRequests = [];
  env.state._viewer = {
    scene: {
      postRender: {
        addEventListener(listener) {
          postRenderListeners.add(listener);
          return () => postRenderListeners.delete(listener);
        },
      },
      primitives: {
        add(primitive) {
          primitives.push(primitive);
          return primitive;
        },
        remove(primitive) {
          const index = primitives.indexOf(primitive);
          if (index >= 0) primitives.splice(index, 1);
          return index >= 0;
        },
      },
    },
  };
  env.services.render = {
    governorRequestRender(reason) {
      renderRequests.push(reason);
    },
  };
  env.record.viewshedColors = viewshedColors(120);
  env.geometry.applyFrustumGeometry(env.record, 12);
  env.geometry.rebuildViewshedVolume(env.record, false);
  const primitive = env.record.viewshedPrimitive;
  assert.ok(primitive);
  const instanceId = env.record.viewshedPrimitiveInstanceId;
  assert.equal(instanceId, 'gev-viewshed:camera-one');
  assert.equal(primitive.geometryInstances.id, instanceId);
  const attributes = { color: new Uint8Array([1, 2, 3, 4]) };
  let attributeReads = 0;
  primitive.getGeometryInstanceAttributes = (id) => {
    assert.equal(id, instanceId);
    attributeReads++;
    return attributes;
  };
  assert.equal(env.geometry.updateViewshedVolumeTint(env.record, true), false);
  assert.equal(
    attributeReads,
    0,
    'Cesium attributes are not read before ready',
  );
  assert.equal(env.record.viewshedActiveTint, false);
  assert.equal(postRenderListeners.size, 1);

  env.geometry.hideViewshedVolume(env.record);
  assert.equal(
    postRenderListeners.size,
    0,
    'hide removes the readiness observer',
  );
  primitive.show = true;
  assert.equal(env.geometry.updateViewshedVolumeTint(env.record, true), false);
  assert.equal(postRenderListeners.size, 1, 're-entry rearms one observer');
  assert.equal(env.geometry.updateViewshedVolumeTint(env.record, false), true);
  assert.equal(
    postRenderListeners.size,
    0,
    'returning to applied tint cancels retry',
  );
  assert.equal(env.geometry.updateViewshedVolumeTint(env.record, true), false);
  assert.equal(postRenderListeners.size, 1);

  primitive._ready = true;
  for (const listener of [...postRenderListeners]) listener();
  assert.equal(attributeReads, 1);
  assert.deepEqual(
    attributes.color,
    Cesium.ColorGeometryInstanceAttribute.toValue(
      env.record.viewshedColors.fillActive,
    ),
  );
  assert.equal(env.record.viewshedActiveTint, true);
  assert.equal(postRenderListeners.size, 0);
  assert.deepEqual(renderRequests, ['cctv-viewshed-tint-ready']);

  primitive.show = false;
  env.record.camera.headingDeg += 1;
  env.geometry.applyFrustumGeometry(env.record, 12);
  assert.equal(env.record.viewshedPrimitive, null);
  assert.equal(primitives.includes(primitive), false);

  env.geometry.rebuildViewshedVolume(env.record, false);
  const terrainBoundPrimitive = env.record.viewshedPrimitive;
  terrainBoundPrimitive.show = false;
  env.geometry.applyFrustumGeometry(env.record, 25);
  assert.equal(env.record.viewshedPrimitive, null);
  assert.equal(primitives.includes(terrainBoundPrimitive), false);

  env.geometry.rebuildViewshedVolume(env.record, false);
  const sourceBoundPrimitive = env.record.viewshedPrimitive;
  sourceBoundPrimitive.show = false;
  env.parts.ground.currentSurfaceRegime = () => 'google-3d';
  env.state._googleGroundSource = {};
  env.geometry.applyFrustumGeometry(env.record, 25);
  env.geometry.rebuildViewshedVolume(env.record, false);
  const googleOwnerPrimitive = env.record.viewshedPrimitive;
  googleOwnerPrimitive.show = false;
  env.state._googleGroundSource = {};
  env.geometry.applyFrustumGeometry(env.record, 25);
  assert.equal(env.record.viewshedPrimitive, null);
  assert.equal(primitives.includes(googleOwnerPrimitive), false);
  assert.equal(primitives.includes(sourceBoundPrimitive), false);

  env.parts.ground.currentSurfaceRegime = () => 'globe';
  const terrainA = {};
  env.state._viewer.terrainProvider = terrainA;
  env.geometry.applyFrustumGeometry(env.record, 25);
  env.geometry.rebuildViewshedVolume(env.record, false);
  const terrainBoundOwnerPrimitive = env.record.viewshedPrimitive;
  terrainBoundOwnerPrimitive.show = false;
  env.state._viewer.terrainProvider = {};
  env.geometry.applyFrustumGeometry(env.record, 25);
  assert.equal(env.record.viewshedPrimitive, null);
  assert.equal(primitives.includes(terrainBoundOwnerPrimitive), false);
});

test('destroyCoverageEntities removes retained viewshed primitives and readiness listeners', () => {
  const env = fixture();
  const primitives = [];
  const listeners = new Set();
  env.state._records = [env.record];
  env.state._coverageEntities = [];
  env.state._projectionEntities = [];
  env.state._viewer = {
    scene: {
      postRender: {
        addEventListener(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      primitives: {
        add(primitive) {
          primitives.push(primitive);
          return primitive;
        },
        remove(primitive) {
          const index = primitives.indexOf(primitive);
          if (index >= 0) primitives.splice(index, 1);
          return index >= 0;
        },
      },
    },
  };
  env.record.viewshedColors = viewshedColors(120);
  env.geometry.applyFrustumGeometry(env.record, 12);
  env.geometry.rebuildViewshedVolume(env.record, false);
  env.geometry.updateViewshedVolumeTint(env.record, true);
  const primitive = env.record.viewshedPrimitive;
  assert.equal(listeners.size, 1);

  env.geometry.destroyCoverageEntities();

  assert.equal(env.record.viewshedPrimitive, null);
  assert.equal(primitives.includes(primitive), false);
  assert.equal(listeners.size, 0);
});

test('viewshed readiness listener retires after a per-instance attribute error', () => {
  const env = fixture();
  const listeners = new Set();
  const primitives = [];
  env.state._viewer = {
    scene: {
      postRender: {
        addEventListener(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      primitives: {
        add(primitive) {
          primitives.push(primitive);
          return primitive;
        },
        remove(primitive) {
          const index = primitives.indexOf(primitive);
          if (index >= 0) primitives.splice(index, 1);
          return index >= 0;
        },
      },
    },
  };
  env.record.viewshedColors = viewshedColors(120);
  env.geometry.applyFrustumGeometry(env.record, 12);
  env.geometry.rebuildViewshedVolume(env.record, false);
  const primitive = env.record.viewshedPrimitive;
  primitive.getGeometryInstanceAttributes = () => {
    throw new Error('attribute lookup failure');
  };
  assert.equal(env.geometry.updateViewshedVolumeTint(env.record, true), false);
  assert.equal(listeners.size, 1);

  primitive._ready = true;
  const [onPostRender] = listeners;
  assert.throws(onPostRender, /attribute lookup failure/);
  assert.equal(listeners.size, 0);
  env.geometry.destroyViewshedVolume(env.record);
  assert.equal(primitives.length, 0);
});

test('settled map source refresh selects the visible tileset over an older hidden owner', () => {
  const hidden = Object.create(Cesium.Cesium3DTileset.prototype);
  hidden._destroyed = false;
  Object.defineProperties(hidden, {
    show: { value: false, configurable: true },
    tilesLoaded: { value: true, configurable: true },
  });
  const visible = Object.create(Cesium.Cesium3DTileset.prototype);
  visible._destroyed = false;
  Object.defineProperties(visible, {
    show: { value: true, configurable: true },
    tilesLoaded: { value: true, configurable: true },
  });
  const state = {
    _viewer: {
      scene: {
        primitives: {
          length: 2,
          get(index) {
            return [hidden, visible][index];
          },
        },
      },
    },
    _activeTileset: hidden,
  };
  const model = createModel({
    state,
    services: {
      focus: { focusPassIsNeeded: () => false, getFocusTarget: () => null },
    },
    parts: {},
    source: {},
  });

  assert.equal(model.refreshProjectionTileset(), true);
  assert.equal(state._activeTileset, visible);
  Object.defineProperty(visible, 'tilesLoaded', {
    value: false,
    configurable: true,
  });
  assert.equal(model.projectionTilesReady(), false);
  assert.equal(state._activeTileset, visible);
});

test('Google ground stays unresolved on DEM fallback until the current mesh owner has a sample', () => {
  const tileset = Object.create(Cesium.Cesium3DTileset.prototype);
  tileset._destroyed = false;
  let meshFloor = null;
  let tilesLoaded = false;
  let samples = 0;
  Object.defineProperties(tileset, {
    show: { value: true, configurable: true },
    tilesLoaded: { get: () => tilesLoaded, configurable: true },
  });
  const state = {
    _viewer: {
      scene: {
        globe: { show: false },
        primitives: { length: 1, get: () => tileset },
      },
    },
  };
  const services = {
    focus: { focusPassIsNeeded: () => false, getFocusTarget: () => null },
    ground: {
      warmGroundFloor() {},
      cachedGroundFloor: () => 100,
      cachedMeshFloor: () => meshFloor,
    },
    mesh: {
      sampleMeshFloorCells() {
        samples++;
        if (tilesLoaded) meshFloor = 118;
      },
    },
  };
  const parts = {
    ground: {
      currentSurfaceRegime: () => 'google-3d',
      groundAltFor: () => 100,
      groundPriorAltFor: () => 100,
    },
    projection: { updatePlanePlacement() {} },
  };
  parts.model = createModel({
    state,
    services: {
      focus: {
        focusPassIsNeeded: () => false,
        getFocusTarget: () => null,
      },
    },
    parts,
    source: {},
  });
  const geometry = createGeometry({ state, services, parts, source: {} });
  const record = {
    camera: {
      id: 'mesh-owner-camera',
      lat: 40.7,
      lon: -73.9,
      headingDeg: 90,
      pitchDeg: -17,
      fovDeg: 74,
      rangeM: 700,
      mountHeightM: 24,
    },
    groundSamples: {},
    groundResolved: {},
    coverageEntities: [],
  };

  geometry.updateRecordGeometry(record);
  assert.equal(record.frustumGeometry.groundAltM, 100);
  assert.equal(record.groundResolved['google-3d'], false);
  assert.equal(record.groundSamples['google-3d'], undefined);
  assert.equal(samples, 0);

  tilesLoaded = true;
  geometry.updateRecordGeometry(record);
  assert.equal(record.frustumGeometry.groundAltM, 118);
  assert.equal(record.groundResolved['google-3d'], true);
  assert.equal(record.groundSamples['google-3d'], 118);
  assert.equal(samples, 1);
});
