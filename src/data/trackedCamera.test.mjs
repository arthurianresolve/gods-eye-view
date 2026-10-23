import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  applyTrackedCameraFrame,
  clampTrackedCameraPosition,
  trackedDisplayPositionForCamera,
  trackedModelScaleForPixelCap,
} from './trackedCamera.js';

function trackedCameraHarness({ controller, entity, camera } = {}) {
  const listeners = new Set();
  const screenSpaceCameraController = controller ?? {
    inertiaZoom: 0.2,
    minimumZoomDistance: 10,
  };
  const trackedEntity = entity ?? {
    gevDisplayPosition: () => new Cesium.Cartesian3(6378137, 0, 0),
  };
  const activeCamera = camera ?? {
    position: new Cesium.Cartesian3(0, -1000, 500),
    direction: new Cesium.Cartesian3(0, 1, 0),
    transform: Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY),
    lookAtTransformCalls: 0,
    lookAtTransform(transform, offset) {
      this.lookAtTransformCalls += 1;
      this.transform = Cesium.Matrix4.clone(transform, this.transform);
      // The fake camera lands at a safe range; subsequent preUpdate calls
      // should leave this EntityView-owned pose alone.
      this.position = Cesium.Cartesian3.clone(
        new Cesium.Cartesian3(0, -1000, 500),
        this.position,
      );
      this.lastOffset = Cesium.Cartesian3.clone(offset);
    },
  };
  const viewer = {
    scene: {
      screenSpaceCameraController,
      preUpdate: {
        addEventListener(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    },
    camera: activeCamera,
    clock: { currentTime: Cesium.JulianDate.now() },
    trackedEntity,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
  };
  return {
    viewer,
    listeners,
    entity: trackedEntity,
    controller: screenSpaceCameraController,
    camera: activeCamera,
    update() {
      for (const listener of [...listeners]) listener();
    },
  };
}

test('tracked camera origin crossing returns to the prior side at the minimum range', () => {
  const camera = {
    position: new Cesium.Cartesian3(0, 500, -300),
    direction: new Cesium.Cartesian3(0, -1, 0),
  };
  const previous = new Cesium.Cartesian3(0, -1000, 600);
  assert.equal(clampTrackedCameraPosition(camera, previous, 150), true);
  assert.ok(Cesium.Cartesian3.dot(camera.position, previous) > 0);
  assert.ok(
    Math.abs(Cesium.Cartesian3.magnitude(camera.position) - 150) < 1e-9,
  );
});

test('tracked camera clamps a too-close approach along the current sight line', () => {
  const camera = {
    position: new Cesium.Cartesian3(0, -80, 0),
    direction: new Cesium.Cartesian3(0, 1, 0),
  };
  const previous = new Cesium.Cartesian3(0, -200, 0);
  assert.equal(clampTrackedCameraPosition(camera, previous, 150), true);
  assert.ok(Math.abs(camera.position.x) === 0);
  assert.equal(camera.position.y, -150);
  assert.ok(Math.abs(camera.position.z) === 0);
});

test('tracked camera leaves a safe approach unchanged', () => {
  const camera = {
    position: new Cesium.Cartesian3(0, -800, 500),
    direction: Cesium.Cartesian3.normalize(
      new Cesium.Cartesian3(0, 800, -500),
      new Cesium.Cartesian3(),
    ),
  };
  const previous = Cesium.Cartesian3.clone(camera.position);
  const before = Cesium.Cartesian3.clone(camera.position);
  assert.equal(clampTrackedCameraPosition(camera, previous, 150), false);
  assert.deepEqual(camera.position, before);
});

test('tracked model keeps calibrated scale when it projects below the pixel cap', () => {
  const scale = trackedModelScaleForPixelCap({
    baseScale: 24,
    nativeRadiusM: 1.43,
    rangeM: 1000,
    viewportHeightPx: 800,
    fovyRad: Math.PI / 3,
    maximumPixelSize: 104,
  });
  assert.equal(scale, 24);
});

test('tracked model shrinks smoothly when close enough to exceed the pixel cap', () => {
  const scale = trackedModelScaleForPixelCap({
    baseScale: 24,
    nativeRadiusM: 1.43,
    rangeM: 150,
    viewportHeightPx: 800,
    fovyRad: Math.PI / 3,
    maximumPixelSize: 104,
  });
  const focalLengthPx = 800 / (2 * Math.tan(Math.PI / 6));
  const projectedDiameterPx = (2 * 1.43 * scale * focalLengthPx) / 150;
  assert.ok(scale < 24);
  assert.ok(Math.abs(projectedDiameterPx - 104) < 1e-9);
});

test('tracked camera prefers the already-rendered display cache', () => {
  let callbackReads = 0;
  const cached = new Cesium.Cartesian3(1, 2, 3);
  const entity = {
    gevDisplayPosition: () => cached,
    position: {
      getValue: () => {
        callbackReads += 1;
        return new Cesium.Cartesian3(4, 5, 6);
      },
    },
  };
  const result = trackedDisplayPositionForCamera(
    entity,
    Cesium.JulianDate.now(),
    new Cesium.Cartesian3(),
  );
  assert.deepEqual(result, cached);
  assert.notEqual(result, cached);
  assert.equal(callbackReads, 0);
});

test('tracked frame establishes once, then leaves safe continuous frames to EntityView', () => {
  let displayReads = 0;
  let callbackReads = 0;
  let offsetReads = 0;
  const harness = trackedCameraHarness({
    entity: {
      gevDisplayPosition: () => {
        displayReads += 1;
        return new Cesium.Cartesian3(6378137, 0, 0);
      },
      position: {
        getValue() {
          callbackReads += 1;
          return new Cesium.Cartesian3(6378137, 1, 0);
        },
      },
    },
  });
  const offset = {
    getValue() {
      offsetReads += 1;
      return new Cesium.Cartesian3(0, -1000, 500);
    },
  };
  const stop = applyTrackedCameraFrame(harness.viewer, harness.entity, offset);

  assert.equal(harness.listeners.size, 1);
  assert.equal(harness.controller.inertiaZoom, 0);
  assert.equal(harness.controller.minimumZoomDistance, 150);
  harness.update();
  assert.equal(harness.camera.lookAtTransformCalls, 1);
  const establishedPosition = Cesium.Cartesian3.clone(harness.camera.position);
  harness.update();
  assert.equal(harness.camera.lookAtTransformCalls, 1);
  assert.deepEqual(harness.camera.position, establishedPosition);
  assert.equal(displayReads, 1);
  assert.equal(callbackReads, 0);
  assert.equal(offsetReads, 1);

  stop();
  stop();
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.controller.inertiaZoom, 0.2);
  assert.equal(harness.controller.minimumZoomDistance, 10);
});

test('tracked-frame zoom settings remain owned until the last shared controller owner stops', () => {
  const controller = { inertiaZoom: 0.35, minimumZoomDistance: 25 };
  const first = trackedCameraHarness({ controller });
  const second = trackedCameraHarness({ controller });
  const stopFirst = applyTrackedCameraFrame(
    first.viewer,
    first.entity,
    new Cesium.Cartesian3(0, -1000, 500),
  );
  const stopSecond = applyTrackedCameraFrame(
    second.viewer,
    second.entity,
    new Cesium.Cartesian3(0, -1000, 500),
  );

  assert.equal(controller.inertiaZoom, 0);
  assert.equal(controller.minimumZoomDistance, 150);
  stopFirst();
  assert.equal(controller.inertiaZoom, 0);
  assert.equal(controller.minimumZoomDistance, 150);
  assert.equal(first.listeners.size, 0);
  assert.equal(second.listeners.size, 1);
  stopSecond();
  assert.equal(controller.inertiaZoom, 0.35);
  assert.equal(controller.minimumZoomDistance, 25);
  assert.equal(second.listeners.size, 0);
});

test('tracked-frame ownership self-releases when tracking changes or the viewer is destroyed', () => {
  for (const retire of [
    (harness) => {
      harness.viewer.trackedEntity = {};
    },
    (harness) => {
      harness.viewer.destroyed = true;
    },
  ]) {
    const harness = trackedCameraHarness();
    const stop = applyTrackedCameraFrame(
      harness.viewer,
      harness.entity,
      new Cesium.Cartesian3(0, -1000, 500),
    );
    harness.update();
    retire(harness);
    harness.update();
    assert.equal(harness.listeners.size, 0);
    assert.equal(harness.controller.inertiaZoom, 0.2);
    assert.equal(harness.controller.minimumZoomDistance, 10);
    stop();
    assert.equal(harness.listeners.size, 0);
  }
});
