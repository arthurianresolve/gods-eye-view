import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import View from '@cesium/engine/Source/Scene/View.js';

// Invoke the installed engine's real comparator without creating a WebGL scene.
// This is a scoped math control, not a rendered frame or GPU measurement.
assert.equal(Cesium.VERSION, '1.138.0');
const scene = {
  canvas: { clientWidth: 1440, clientHeight: 900, width: 1440, height: 900 },
  drawingBufferWidth: 1440,
  drawingBufferHeight: 900,
  mapProjection: new Cesium.GeographicProjection(Cesium.Ellipsoid.WGS84),
  globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
  mapMode2D: Cesium.MapMode2D.INFINITE_SCROLL,
  mode: Cesium.SceneMode.SCENE3D,
  pixelRatio: 1,
  cameraEventWaitTime: 500,
};
const camera = new Cesium.Camera(scene);
scene.camera = camera;
camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 130000),
  orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
});
let moves = 0;
camera.moveStart.addEventListener(() => moves++);
const view = {
  camera,
  _cameraClone: Cesium.Camera.clone(camera),
  _cameraStartFired: false,
};
const home = {
  position: Cesium.Cartesian3.clone(camera.position),
  direction: Cesium.Cartesian3.clone(camera.direction),
  up: Cesium.Cartesian3.clone(camera.up),
  transform: Cesium.Matrix4.clone(camera.transform),
};
camera.setView({
  destination: home.position,
  orientation: { direction: home.direction, up: home.up },
  endTransform: home.transform,
});
const repeated = {
  positionDeltaM: Cesium.Cartesian3.distance(home.position, camera.position),
  directionDelta: Cesium.Cartesian3.distance(home.direction, camera.direction),
  upDelta: Cesium.Cartesian3.distance(home.up, camera.up),
  cameraChanged: View.prototype.checkForCameraUpdates.call(view, scene),
  moveStartEvents: moves,
};
assert.equal(repeated.cameraChanged, false);
assert.equal(repeated.moveStartEvents, 0);

camera.moveRight(1);
const realMovement = {
  cameraChanged: View.prototype.checkForCameraUpdates.call(view, scene),
  moveStartEvents: moves,
};
assert.equal(realMovement.cameraChanged, true);
assert.equal(realMovement.moveStartEvents, 1);

const result = {
  schema: 'gev-pinned-camera-setup-control/v1',
  sourceCommit: 'f7e0709c8536fb8ca63619fd5288ae3a4123602e',
  cesiumVersion: Cesium.VERSION,
  scope: 'Actual Cesium Camera and View comparator in Node; no browser or GPU',
  repeated,
  realMovement,
  interpretation:
    'The repeated saved-pose write at this fixture pose does not itself cause a camera-change event. This control does not assess initial layer enable order, other poses, rendering costs or browser scheduling.',
};
writeFileSync(
  new URL('camera-setup-review.json', import.meta.url),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result));
