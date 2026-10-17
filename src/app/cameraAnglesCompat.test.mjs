import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import View from '@cesium/engine/Source/Scene/View.js';
import { installCesium138CameraAnglesCompat } from './cameraAnglesCompat.js';

const cesiumScene = () => ({
  drawingBufferWidth: 1200,
  drawingBufferHeight: 800,
  ellipsoid: Cesium.Ellipsoid.WGS84,
  mapProjection: new Cesium.GeographicProjection(Cesium.Ellipsoid.WGS84),
  mode: Cesium.SceneMode.SCENE3D,
});

function makeCamera(configure) {
  const scene = cesiumScene();
  const camera = new Cesium.Camera(scene);
  configure(camera, scene);
  return { camera, scene, viewer: { camera, scene } };
}

const pose = (camera, { lon, lat, height, heading, pitch, roll }) =>
  camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    orientation: { heading, pitch, roll },
  });

function angleDelta(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

test('Cesium 1.138 stock HPR polling drifts the view basis without raising changed', () => {
  const f = makeCamera((camera) =>
    pose(camera, {
      lon: -97.7431,
      lat: 30.2672,
      height: 3500,
      heading: 0,
      pitch: -Cesium.Math.PI_OVER_TWO,
      roll: 0,
    }),
  );
  let changed = 0;
  f.camera.changed.addEventListener(() => changed++);
  const initial = Cesium.Cartesian3.clone(f.camera.direction);
  const initialUp = Cesium.Cartesian3.clone(f.camera.up);
  const view = {
    camera: f.camera,
    _cameraClone: Cesium.Camera.clone(f.camera),
    _cameraStartFired: false,
  };
  let viewDetectedChanges = 0;
  for (let i = 0; i < 600; i++) {
    f.camera._updateCameraChanged();
    if (View.prototype.checkForCameraUpdates.call(view, f.scene))
      viewDetectedChanges++;
  }
  assert.equal(changed, 0);
  assert.ok(viewDetectedChanges > 0);
  assert.ok(
    Cesium.Cartesian3.distance(initial, f.camera.direction) > 1e-15 ||
      Cesium.Cartesian3.distance(initialUp, f.camera.up) > 1e-15,
    'the pinned Cesium getter path should reproduce the no-event drift',
  );
});

test('compat HPR values match native getters across poses and tracked transforms', () => {
  const scenarios = [
    (camera) =>
      pose(camera, {
        lon: -122.3321,
        lat: 47.6062,
        height: 3500,
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO,
        roll: 0,
      }),
    (camera) =>
      pose(camera, {
        lon: 12.4924,
        lat: 41.8902,
        height: 125000,
        heading: 1.7,
        pitch: -0.8,
        roll: 0.35,
      }),
    (camera) =>
      pose(camera, {
        lon: 151.2093,
        lat: -33.8688,
        height: 900,
        heading: 4.9,
        pitch: -1.2,
        roll: 5.7,
      }),
    (camera) =>
      pose(camera, {
        lon: 18.9553,
        lat: 89.9999,
        height: 2400,
        heading: 5.9,
        pitch: -Cesium.Math.PI_OVER_TWO + 1e-8,
        roll: 0.7,
      }),
    (camera) => {
      const origin = Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 0);
      const transform = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
      camera.lookAtTransform(
        transform,
        new Cesium.HeadingPitchRange(1.15, -0.42, 18000),
      );
    },
  ];

  for (const configure of scenarios) {
    const expected = makeCamera(configure);
    const actual = makeCamera(configure);
    const expectedAngles = [
      expected.camera.heading,
      expected.camera.pitch,
      expected.camera.roll,
    ];
    const compat = installCesium138CameraAnglesCompat(actual.viewer);
    assert.equal(compat.installed, true);
    const actualAngles = [
      actual.camera.heading,
      actual.camera.pitch,
      actual.camera.roll,
    ];
    for (let i = 0; i < actualAngles.length; i++)
      assert.ok(angleDelta(actualAngles[i], expectedAngles[i]) <= 1e-12);
    compat.dispose();
  }
});

test('compat getters keep repeated camera-change polling stable and dispose cleanly', () => {
  const f = makeCamera((camera) =>
    pose(camera, {
      lon: -97.7431,
      lat: 30.2672,
      height: 3500,
      heading: 0,
      pitch: -Cesium.Math.PI_OVER_TWO,
      roll: 0,
    }),
  );
  const initialDirection = Cesium.Cartesian3.clone(f.camera.direction);
  const initialUp = Cesium.Cartesian3.clone(f.camera.up);
  let changed = 0;
  f.camera.changed.addEventListener(() => changed++);
  const compat = installCesium138CameraAnglesCompat(f.viewer);
  assert.equal(compat.installed, true);

  const view = {
    camera: f.camera,
    _cameraClone: Cesium.Camera.clone(f.camera),
    _cameraStartFired: false,
  };
  let viewDetectedChanges = 0;
  for (let i = 0; i < 600; i++) {
    f.camera._updateCameraChanged();
    if (View.prototype.checkForCameraUpdates.call(view, f.scene))
      viewDetectedChanges++;
  }
  assert.equal(changed, 0);
  assert.equal(viewDetectedChanges, 0);
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      f.camera.direction,
      initialDirection,
      0,
      1e-15,
    ),
  );
  assert.ok(Cesium.Cartesian3.equalsEpsilon(f.camera.up, initialUp, 0, 1e-15));

  compat.dispose();
  compat.dispose();
  assert.equal(Object.hasOwn(f.camera, 'heading'), false);
  assert.equal(Object.hasOwn(f.camera, 'pitch'), false);
  assert.equal(Object.hasOwn(f.camera, 'roll'), false);
});

test('compat reads continue to follow real camera rotations', () => {
  const f = makeCamera((camera) =>
    pose(camera, {
      lon: -97.7431,
      lat: 30.2672,
      height: 3500,
      heading: 0.2,
      pitch: -0.7,
      roll: 0.1,
    }),
  );
  const compat = installCesium138CameraAnglesCompat(f.viewer);
  assert.equal(compat.installed, true);
  pose(f.camera, {
    lon: -97.7431,
    lat: 30.2672,
    height: 3500,
    heading: 1.3,
    pitch: -0.4,
    roll: 0.35,
  });
  assert.ok(angleDelta(f.camera.heading, 1.3) <= 1e-12);
  assert.ok(angleDelta(f.camera.pitch, -0.4) <= 1e-12);
  assert.ok(angleDelta(f.camera.roll, 0.35) <= 1e-12);
  compat.dispose();
});

test('compat falls back outside SCENE3D and does not overwrite later camera accessors', () => {
  const f = makeCamera((camera) =>
    pose(camera, {
      lon: 10,
      lat: 30,
      height: 50000,
      heading: 0.4,
      pitch: -0.5,
      roll: 0.1,
    }),
  );
  const compat = installCesium138CameraAnglesCompat(f.viewer);
  f.scene.mode = Cesium.SceneMode.SCENE2D;
  assert.ok(Number.isFinite(f.camera.heading));
  Object.defineProperty(f.camera, 'heading', {
    configurable: true,
    get: () => 123,
  });
  compat.dispose();
  assert.equal(f.camera.heading, 123);
});

test('compat does not install outside SCENE3D', () => {
  const f = makeCamera(() => {});
  f.scene.mode = Cesium.SceneMode.SCENE2D;
  const compat = installCesium138CameraAnglesCompat(f.viewer);
  assert.equal(compat.installed, false);
  assert.equal(Object.hasOwn(f.camera, 'heading'), false);
});

test('partial installation restores only accessors it successfully replaced', () => {
  const f = makeCamera(() => {});
  const originalRoll = () => 42;
  Object.defineProperty(f.camera, 'pitch', {
    configurable: false,
    get: () => 17,
  });
  Object.defineProperty(f.camera, 'roll', {
    configurable: true,
    get: originalRoll,
  });

  assert.throws(() => installCesium138CameraAnglesCompat(f.viewer), /pitch/);
  assert.equal(Object.hasOwn(f.camera, 'heading'), false);
  assert.equal(f.camera.pitch, 17);
  assert.equal(
    Object.getOwnPropertyDescriptor(f.camera, 'roll').get,
    originalRoll,
  );
  assert.equal(f.camera.roll, 42);
});
