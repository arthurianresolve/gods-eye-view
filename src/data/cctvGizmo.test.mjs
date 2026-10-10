// src/data/cctvGizmo.test.mjs — pure drag math for the CCTV calibration gizmo
// (docs/superpowers/specs/2026-07-05-cctv-viewshed-gizmo-design.md §3c).
//
// Locks:
//   - closestParamOnAxis returns the metre-parameter along the AXIS of the
//     point nearest the mouse ray (the workhorse for arrow/range drags), and
//     refuses near-parallel configurations instead of exploding;
//   - rayPlaneIntersect refuses grazing rays (|dir·normal| < 0.08 — spec §5
//     precision guard) and behind-origin hits;
//   - ringAngle/signedAngleDelta give quadrant-correct, wrap-safe angles for
//     the heading/pitch ring drags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  createCalibrationGizmo,
  closestParamOnAxis,
  rayPlaneIntersect,
  ringAngle,
  signedAngleDelta,
} from './cctvGizmo.js';

const c3 = (x, y, z) => new Cesium.Cartesian3(x, y, z);

function createGizmoViewer() {
  const entities = new Map();
  const listeners = new Map();
  let picked = null;
  const canvas = {
    disableRootEvents: true,
    clientWidth: 800,
    clientHeight: 600,
    style: {},
    addEventListener(type, callback) {
      const values = listeners.get(type) || new Set();
      values.add(callback);
      listeners.set(type, values);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    },
    dispatch(type, event) {
      for (const callback of listeners.get(type) || []) callback(event);
    },
  };
  return {
    entities: {
      getById(id) {
        return entities.get(id) || null;
      },
      add(value) {
        const entity = { ...value };
        entities.set(entity.id, entity);
        return entity;
      },
      remove(value) {
        return entities.delete(value.id);
      },
    },
    scene: {
      canvas,
      screenSpaceCameraController: { enableInputs: true },
      pick: () => picked,
      drillPick: () => [],
    },
    camera: { getPickRay: () => null },
    _entities: entities,
    _setPicked(value) {
      picked = value;
    },
  };
}

function createEngineControllerGizmoViewer() {
  const listeners = new Map();
  const canvas = {
    disableRootEvents: true,
    clientWidth: 800,
    clientHeight: 600,
    drawingBufferWidth: 800,
    drawingBufferHeight: 600,
    onwheel: null,
    style: {},
    addEventListener(type, callback) {
      const values = listeners.get(type) || new Set();
      values.add(callback);
      listeners.set(type, values);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    },
    dispatch(type, event) {
      for (const callback of listeners.get(type) || []) callback(event);
    },
  };
  const scene = {
    canvas,
    drawingBufferWidth: 800,
    drawingBufferHeight: 600,
    mapProjection: new Cesium.GeographicProjection(Cesium.Ellipsoid.WGS84),
    ellipsoid: Cesium.Ellipsoid.WGS84,
  };
  const camera = new Cesium.Camera(scene);
  camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-97.7, 30.3, 10_000_000),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  });
  Object.assign(scene, {
    camera,
    globe: undefined,
    mode: Cesium.SceneMode.SCENE3D,
    verticalExaggeration: 1,
    verticalExaggerationRelativeHeight: 0,
    cameraUnderground: false,
    postUpdate: new Cesium.Event(),
    pick: () => ({ id: { id: 'cctv-gizmo-move-east' } }),
    drillPick: () => [],
  });
  const controller = new Cesium.ScreenSpaceCameraController(scene);
  controller.enableCollisionDetection = false;
  scene.screenSpaceCameraController = controller;
  const entities = new Map();
  const viewer = {
    scene,
    camera: { getPickRay: () => null },
    entities: {
      getById: (id) => entities.get(id) || null,
      add(value) {
        const entity = { ...value };
        entities.set(entity.id, entity);
        return entity;
      },
      remove(value) {
        return entities.delete(value.id);
      },
    },
  };
  return { viewer, entities, controller };
}

test('closestParamOnAxis: perpendicular ray hits the axis at its own offset', () => {
  // Axis along +X from origin. Ray shooting straight down (-Z) from (10, 0, 5):
  // nearest axis point is x=10 → t=10.
  const t = closestParamOnAxis(c3(10, 0, 5), c3(0, 0, -1), c3(0, 0, 0), c3(1, 0, 0));
  assert.ok(Math.abs(t - 10) < 1e-9, `expected 10, got ${t}`);
});

test('closestParamOnAxis: skew ray resolves to the geometric closest point', () => {
  // Axis +X. Ray from (0, 10, 0) toward (1, -1, 0)/√2 passes closest to the
  // axis around x=10 (it reaches y=0 at x=10).
  const dir = Cesium.Cartesian3.normalize(c3(1, -1, 0), new Cesium.Cartesian3());
  const t = closestParamOnAxis(c3(0, 10, 0), dir, c3(0, 0, 0), c3(1, 0, 0));
  assert.ok(Math.abs(t - 10) < 1e-6, `expected ~10, got ${t}`);
});

test('closestParamOnAxis: axis origin offset shifts the parameter', () => {
  const t = closestParamOnAxis(c3(10, 0, 5), c3(0, 0, -1), c3(4, 0, 0), c3(1, 0, 0));
  assert.ok(Math.abs(t - 6) < 1e-9, `expected 6, got ${t}`);
});

test('closestParamOnAxis: near-parallel ray/axis returns null', () => {
  assert.equal(closestParamOnAxis(c3(0, 1, 0), c3(1, 0, 0), c3(0, 0, 0), c3(1, 0, 0)), null);
  const nearly = Cesium.Cartesian3.normalize(c3(1, 1e-9, 0), new Cesium.Cartesian3());
  assert.equal(closestParamOnAxis(c3(0, 1, 0), nearly, c3(0, 0, 0), c3(1, 0, 0)), null);
});

test('rayPlaneIntersect: straight-on hit lands at the expected point', () => {
  const hit = rayPlaneIntersect(c3(0, 0, 10), c3(0, 0, -1), c3(0, 0, 0), c3(0, 0, 1));
  assert.ok(hit, 'expected a hit');
  assert.ok(Cesium.Cartesian3.distance(hit, c3(0, 0, 0)) < 1e-9);
});

test('rayPlaneIntersect: oblique hit resolves correctly', () => {
  const dir = Cesium.Cartesian3.normalize(c3(1, 0, -1), new Cesium.Cartesian3());
  const hit = rayPlaneIntersect(c3(0, 0, 5), dir, c3(0, 0, 0), c3(0, 0, 1));
  assert.ok(hit);
  assert.ok(Cesium.Cartesian3.distance(hit, c3(5, 0, 0)) < 1e-9, `got ${hit}`);
});

test('rayPlaneIntersect: grazing ray (|dir·n| < 0.08) returns null', () => {
  // dir almost in-plane: z component 0.05 < 0.08 threshold.
  const dir = Cesium.Cartesian3.normalize(c3(1, 0, -0.05), new Cesium.Cartesian3());
  assert.equal(rayPlaneIntersect(c3(0, 0, 5), dir, c3(0, 0, 0), c3(0, 0, 1)), null);
});

test('rayPlaneIntersect: plane behind the ray origin returns null', () => {
  assert.equal(rayPlaneIntersect(c3(0, 0, 10), c3(0, 0, 1), c3(0, 0, 0), c3(0, 0, 1)), null);
});

test('ringAngle: quadrant sweep in the (basisA, basisB) frame', () => {
  const center = c3(0, 0, 0);
  const a = c3(1, 0, 0);
  const b = c3(0, 1, 0);
  assert.ok(Math.abs(ringAngle(c3(5, 0, 0), center, a, b) - 0) < 1e-9);
  assert.ok(Math.abs(ringAngle(c3(0, 5, 0), center, a, b) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.abs(ringAngle(c3(-5, 0, 0), center, a, b)) - Math.PI) < 1e-9);
  assert.ok(Math.abs(ringAngle(c3(0, -5, 0), center, a, b) + Math.PI / 2) < 1e-9);
});

test('signedAngleDelta: shortest-path wrap', () => {
  const d2r = (d) => (d * Math.PI) / 180;
  assert.ok(Math.abs(signedAngleDelta(d2r(170), d2r(-170)) - d2r(20)) < 1e-9);
  assert.ok(Math.abs(signedAngleDelta(d2r(-170), d2r(170)) - d2r(-20)) < 1e-9);
  assert.ok(Math.abs(signedAngleDelta(d2r(10), d2r(30)) - d2r(20)) < 1e-9);
});

test('gizmo visibility refreshes request discrete frames and stop after disposal', (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    onmousewheel: null,
    addEventListener() {},
    removeEventListener() {},
  };
  t.after(() => {
    globalThis.document = previousDocument;
  });
  const viewer = createGizmoViewer();
  const requests = [];
  const mount = Cesium.Cartesian3.fromDegrees(-97, 30, 20);
  const positions = {
    mount,
    capCenter: Cesium.Cartesian3.fromDegrees(-97, 30, 720),
    tl: Cesium.Cartesian3.fromDegrees(-97.0001, 30.0001, 720),
    tr: Cesium.Cartesian3.fromDegrees(-96.9999, 30.0001, 720),
    bl: Cesium.Cartesian3.fromDegrees(-97.0001, 29.9999, 720),
    br: Cesium.Cartesian3.fromDegrees(-96.9999, 29.9999, 720),
  };
  const record = {
    camera: { headingDeg: 0, pitchDeg: -17, rangeM: 700, basePose: {} },
    frustumPositions: positions,
    frustumGeometry: { rangeM: 700 },
  };
  const gizmo = createCalibrationGizmo({
    viewer,
    getActiveRecord: () => record,
    applyPatch() {},
    endPatch() {},
    requestRender: (reason) => requests.push(reason),
  });

  gizmo.setEnabled(true);
  assert.equal(requests.at(-1), 'cctv-gizmo-refresh');
  assert.equal([...viewer._entities.values()].every((entity) => entity.show), true);
  viewer._setPicked({ id: { id: 'cctv-gizmo-handle-range' } });
  const move = () =>
    viewer.scene.canvas.dispatch('mousemove', {
      clientX: 20,
      clientY: 20,
      button: 0,
      buttons: 0,
      preventDefault() {},
    });
  const beforeHover = requests.length;
  move();
  assert.equal(requests.length, beforeHover + 1);
  assert.equal(viewer._entities.get('cctv-gizmo-handle-range').point.pixelSize, 17);
  move();
  assert.equal(requests.length, beforeHover + 1, 'unchanged hover is throttled');
  gizmo.refresh();
  assert.equal(requests.length, beforeHover + 2);

  gizmo.setEnabled(false);
  assert.equal(requests.at(-1), 'cctv-gizmo-disabled');
  assert.equal([...viewer._entities.values()].some((entity) => entity.show), false);
  const beforeDispose = requests.length;
  gizmo.destroy();
  gizmo.refresh();
  gizmo.setEnabled(true);
  assert.equal(requests.length, beforeDispose);
  assert.equal(viewer._entities.size, 0);
});

test('native release commits the final pointer position skipped by drag throttling', (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    onmousewheel: null,
    addEventListener() {},
    removeEventListener() {},
  };
  t.after(() => {
    globalThis.document = previousDocument;
  });
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const viewer = createGizmoViewer();
  const mount = Cesium.Cartesian3.fromDegrees(0, 0, 0);
  const record = {
    camera: {
      headingDeg: 0,
      pitchDeg: -17,
      calibration: {
        offsetEastM: 0,
        offsetNorthM: 0,
        headingDeg: 0,
        pitchDeg: 0,
        rangeScale: 1,
        heightM: 0,
      },
      basePose: { rangeM: 700, fovDeg: 70 },
    },
    frustumPositions: {
      mount,
      capCenter: c3(mount.x + 700, 0, 0),
      tl: mount,
      tr: mount,
      bl: mount,
      br: mount,
    },
    frustumGeometry: { rangeM: 700 },
  };
  // At lon/lat zero, local east is +Y and up is +X. Each CSS x pixel
  // represents one eastward metre in this deterministic camera-ray adapter.
  viewer.camera.getPickRay = (position) => ({
    origin: c3(mount.x + 100, position.x, 0),
    direction: c3(-1, 0, 0),
  });
  viewer._setPicked({ id: { id: 'cctv-gizmo-move-east' } });
  const patches = [];
  const commits = [];
  let activeRecord = record;
  const gizmo = createCalibrationGizmo({
    viewer,
    getActiveRecord: () => activeRecord,
    applyPatch(patch, target) {
      patches.push(patch);
      Object.assign(target.camera.calibration, patch);
    },
    endPatch(target) {
      commits.push(target.camera.calibration.offsetEastM);
    },
  });
  t.after(() => gizmo.destroy());
  gizmo.setEnabled(true);
  const input = (type, x, buttons) =>
    viewer.scene.canvas.dispatch(type, {
      clientX: x,
      clientY: 20,
      button: 0,
      buttons,
      preventDefault() {},
    });
  input('mousedown', 0, 1);
  assert.equal(gizmo.isDragging(), true);
  input('mousemove', 10, 1);
  now += 1;
  input('mousemove', 20, 1);
  assert.equal(
    patches.length,
    1,
    'second move is deliberately inside the 16 ms throttle',
  );
  input('mouseup', 20, 0);
  assert.deepEqual(commits, [20]);
  assert.deepEqual(
    patches.map((patch) => patch.offsetEastM),
    [10, 20],
  );
  assert.equal(gizmo.isDragging(), false);
  assert.equal(viewer.scene.screenSpaceCameraController.enableInputs, true);

  now += 20;
  input('mousedown', 0, 1);
  input('mousemove', 10, 1);
  const beforeEqualRelease = patches.length;
  input('mouseup', 10, 0);
  assert.equal(
    patches.length,
    beforeEqualRelease,
    'equal release does not duplicate the last accepted patch',
  );
  assert.deepEqual(commits, [20, 30]);

  now += 20;
  input('mousedown', 0, 1);
  input('mousemove', 10, 1);
  activeRecord = { ...record, camera: { ...record.camera } };
  const beforeSwitchedRelease = patches.length;
  input('mouseup', 20, 0);
  assert.equal(
    patches.length,
    beforeSwitchedRelease,
    'selection switch prevents a late endpoint patch',
  );
  assert.deepEqual(
    commits,
    [20, 30, 40],
    'existing edits commit to the original record',
  );
  assert.equal(viewer.scene.screenSpaceCameraController.enableInputs, true);
});

test('gizmo lock drains actual Cesium camera input before restoring its owner value', (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = { onmousewheel: undefined };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });

  const { viewer, controller } = createEngineControllerGizmoViewer();
  const mount = Cesium.Cartesian3.fromDegrees(0, 0, 0);
  const record = {
    camera: {
      headingDeg: 0,
      pitchDeg: -17,
      calibration: { offsetEastM: 0 },
      basePose: { rangeM: 700, fovDeg: 70 },
    },
    frustumPositions: {
      mount,
      capCenter: c3(mount.x + 700, 0, 0),
      tl: mount,
      tr: mount,
      bl: mount,
      br: mount,
    },
    frustumGeometry: { rangeM: 700 },
  };
  viewer.camera.getPickRay = (position) => ({
    origin: c3(mount.x + 100, position.x, 0),
    direction: c3(-1, 0, 0),
  });
  const gizmo = createCalibrationGizmo({
    viewer,
    getActiveRecord: () => record,
    applyPatch(patch, target) {
      Object.assign(target.camera.calibration, patch);
    },
    endPatch() {},
  });
  t.after(() => {
    gizmo.destroy();
    controller.destroy();
  });
  gizmo.setEnabled(true);

  const originalDescriptor = Object.getOwnPropertyDescriptor(
    controller,
    'enableInputs',
  );
  const beforePosition = Cesium.Cartesian3.clone(
    viewer.scene.camera.positionWC,
  );
  const beforeDirection = Cesium.Cartesian3.clone(
    viewer.scene.camera.directionWC,
  );
  const input = (type, x, y, buttons) =>
    viewer.scene.canvas.dispatch(type, {
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
      preventDefault() {},
    });

  input('mousedown', 400, 300, 1);
  input('mousemove', 440, 330, 1);
  input('mouseup', 440, 330, 0);
  assert.equal(controller.enableInputs, false);
  assert.equal(
    controller._aggregator.isMoving(Cesium.CameraEventType.LEFT_DRAG),
    true,
  );
  controller.update();
  assert.equal(
    Cesium.Cartesian3.distance(beforePosition, viewer.scene.camera.positionWC),
    0,
  );
  assert.equal(
    Cesium.Cartesian3.distance(
      beforeDirection,
      viewer.scene.camera.directionWC,
    ),
    0,
  );
  viewer.scene.postUpdate.raiseEvent(viewer.scene, Cesium.JulianDate.now());
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(controller, 'enableInputs'),
    originalDescriptor,
  );

  // A cockpit-style lock requested while the gizmo owns the drag is retained.
  input('mousedown', 400, 300, 1);
  input('mousemove', 420, 310, 1);
  controller.enableInputs = false;
  assert.equal(controller.enableInputs, false);
  input('mouseup', 420, 310, 0);
  controller.update();
  viewer.scene.postUpdate.raiseEvent(viewer.scene, Cesium.JulianDate.now());
  assert.equal(controller.enableInputs, false);
  assert.equal(
    Object.getOwnPropertyDescriptor(controller, 'enableInputs').value,
    false,
  );

  // A later request to enable is delayed until the queued camera event is drained.
  input('mousedown', 400, 300, 1);
  input('mousemove', 425, 315, 1);
  controller.enableInputs = true;
  assert.equal(controller.enableInputs, false);
  input('mouseup', 425, 315, 0);
  controller.update();
  assert.equal(controller.enableInputs, false);
  viewer.scene.postUpdate.raiseEvent(viewer.scene, Cesium.JulianDate.now());
  assert.equal(controller.enableInputs, true);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(controller, 'enableInputs'),
    originalDescriptor,
  );
});

test('replacement gizmo cancels a destroyed owners pending camera restore', (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = { onmousewheel: undefined };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });

  const { viewer, controller } = createEngineControllerGizmoViewer();
  const mount = Cesium.Cartesian3.fromDegrees(0, 0, 0);
  const record = {
    camera: {
      headingDeg: 0,
      pitchDeg: -17,
      calibration: { offsetEastM: 0 },
      basePose: { rangeM: 700, fovDeg: 70 },
    },
    frustumPositions: {
      mount,
      capCenter: c3(mount.x + 700, 0, 0),
      tl: mount,
      tr: mount,
      bl: mount,
      br: mount,
    },
    frustumGeometry: { rangeM: 700 },
  };
  viewer.camera.getPickRay = (position) => ({
    origin: c3(mount.x + 100, position.x, 0),
    direction: c3(-1, 0, 0),
  });
  const makeGizmo = () =>
    createCalibrationGizmo({
      viewer,
      getActiveRecord: () => record,
      applyPatch() {},
      endPatch() {},
    });
  const oldGizmo = makeGizmo();
  const nextGizmo = makeGizmo();
  t.after(() => {
    oldGizmo.destroy();
    nextGizmo.destroy();
    controller.destroy();
  });
  oldGizmo.setEnabled(true);
  const input = (type, x, y, buttons) =>
    viewer.scene.canvas.dispatch(type, {
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
      preventDefault() {},
    });

  input('mousedown', 400, 300, 1);
  input('mousemove', 410, 310, 1);
  oldGizmo.destroy();
  input('mouseup', 410, 310, 0);
  assert.equal(viewer.scene.postUpdate.numberOfListeners, 1);

  nextGizmo.setEnabled(true);
  input('mousedown', 400, 300, 1);
  assert.equal(nextGizmo.isDragging(), true);
  assert.equal(viewer.scene.postUpdate.numberOfListeners, 0);
  input('mousemove', 420, 315, 1);
  input('mouseup', 420, 315, 0);
  assert.equal(viewer.scene.postUpdate.numberOfListeners, 1);
  controller.update();
  viewer.scene.postUpdate.raiseEvent(viewer.scene, Cesium.JulianDate.now());
  assert.equal(controller.enableInputs, true);
  assert.equal(viewer.scene.postUpdate.numberOfListeners, 0);
});
