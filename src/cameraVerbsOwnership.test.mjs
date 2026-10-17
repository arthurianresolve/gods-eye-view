import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';

import {
  activeCameraMotionId,
  disposeCameraVerbs,
  flyRoute,
  getActiveCameraMotion,
  initCameraVerbs,
  moveCamera,
} from './cameraVerbs.js';
import { createApplication } from './app/application.js';
import { destroyApplicationSceneViewer } from './app/sceneViewerLifecycle.js';
import { getRenderGovernorDiagnostics } from './renderGovernor.js';

function createViewer() {
  const onTick = new Cesium.Event();
  const tickCallbacks = [];
  const addTickListener = onTick.addEventListener.bind(onTick);
  onTick.addEventListener = (callback, scope) => {
    tickCallbacks.push(callback);
    return addTickListener(callback, scope);
  };
  const inputListeners = new Map();
  const canvas = {
    addEventListener(type, callback) {
      const listeners = inputListeners.get(type) || new Set();
      listeners.add(callback);
      inputListeners.set(type, listeners);
    },
    removeEventListener(type, callback) {
      inputListeners.get(type)?.delete(callback);
    },
  };
  const writes = [];
  const camera = {
    pitch: -Math.PI / 4,
    positionCartographic: { height: 1_000 },
    moveLeft: (amount) => writes.push({ operation: 'left', amount }),
    moveRight: (amount) => writes.push({ operation: 'right', amount }),
    moveUp: (amount) => writes.push({ operation: 'up', amount }),
    moveDown: (amount) => writes.push({ operation: 'down', amount }),
    lookUp: (amount) => writes.push({ operation: 'look-up', amount }),
    lookDown: (amount) => writes.push({ operation: 'look-down', amount }),
    lookLeft: (amount) => writes.push({ operation: 'look-left', amount }),
    lookRight: (amount) => writes.push({ operation: 'look-right', amount }),
    lookAtTransform() {},
  };
  const viewer = {
    destroyed: false,
    clock: { onTick },
    scene: { canvas, tweens: [], requestRender() {} },
    camera,
    isDestroyed() {
      return this.destroyed;
    },
    destroy() {
      this.destroyed = true;
    },
  };
  return {
    viewer,
    onTick,
    tickCallbacks,
    inputListeners,
    writes,
    canvas,
  };
}

function tick(viewer) {
  viewer.onTick.raiseEvent(viewer.viewer.clock);
}

function startPan() {
  return moveCamera({ motion: 'pan', direction: 'left', mode: 'continuous' });
}

test('shared callers reuse one viewer registration and owner teardown stops motion', () => {
  const owner = createViewer();
  const targetGetter = () => null;

  // Voice and Directions both initialize this shared module for the same app
  // viewer. Their registrations are one viewer-owned set, not consumer leases.
  assert.equal(initCameraVerbs(owner.viewer, targetGetter), true);
  assert.equal(initCameraVerbs(owner.viewer), true);
  assert.equal(owner.onTick.numberOfListeners, 1);
  assert.equal(owner.inputListeners.get('pointerdown').size, 1);
  assert.equal(owner.inputListeners.get('wheel').size, 1);

  assert.equal(startPan().ok, true);
  assert.ok(getRenderGovernorDiagnostics().holds.includes('camera-verb'));
  tick(owner);
  assert.equal(owner.writes.length, 1);
  const staleTick = owner.tickCallbacks[0];
  const stalePointer = [...owner.inputListeners.get('pointerdown')][0];

  assert.equal(disposeCameraVerbs(owner.viewer), true);
  assert.equal(activeCameraMotionId(), 0);
  assert.equal(getActiveCameraMotion(), null);
  assert.ok(!getRenderGovernorDiagnostics().holds.includes('camera-verb'));
  assert.equal(owner.onTick.numberOfListeners, 0);
  assert.equal(owner.inputListeners.get('pointerdown').size, 0);
  assert.equal(owner.inputListeners.get('wheel').size, 0);

  // Even if an event producer already copied the old callback, it cannot write.
  staleTick();
  stalePointer();
  assert.equal(owner.writes.length, 1);
  assert.equal(moveCamera({ motion: 'pan', direction: 'left' }).ok, false);
  assert.equal(
    disposeCameraVerbs(owner.viewer),
    false,
    'disposal is idempotent',
  );
});

test('replacement clears old motion and stale owner callbacks cannot affect the new viewer', () => {
  const first = createViewer();
  const second = createViewer();
  initCameraVerbs(first.viewer);
  assert.equal(startPan().ok, true);
  const oldTick = first.tickCallbacks[0];
  const oldPointer = [...first.inputListeners.get('pointerdown')][0];

  assert.equal(initCameraVerbs(second.viewer), true);
  assert.equal(
    activeCameraMotionId(),
    0,
    'motion cannot migrate to the new viewer',
  );
  assert.equal(first.onTick.numberOfListeners, 0);
  assert.equal(first.inputListeners.get('pointerdown').size, 0);
  assert.equal(
    disposeCameraVerbs(first.viewer),
    false,
    'stale owner is rejected',
  );

  assert.equal(startPan().ok, true);
  oldTick();
  oldPointer();
  assert.equal(
    second.writes.length,
    0,
    'stale callbacks do not write or interrupt',
  );
  tick(second);
  assert.equal(second.writes.length, 1);
  assert.equal(first.writes.length, 0);

  assert.equal(disposeCameraVerbs(second.viewer), true);
  assert.equal(second.onTick.numberOfListeners, 0);
  assert.equal(
    initCameraVerbs(second.viewer),
    true,
    'the same viewer can be reinitialized',
  );
  assert.equal(second.onTick.numberOfListeners, 1);
  assert.equal(startPan().ok, true);
  tick(second);
  assert.equal(second.writes.length, 2);
  assert.equal(disposeCameraVerbs(second.viewer), true);
});

test('retired callbacks stay inert when the same viewer is reinitialized', () => {
  const owner = createViewer();
  initCameraVerbs(owner.viewer);
  assert.equal(startPan().ok, true);
  const retiredTick = owner.tickCallbacks[0];
  const retiredPointer = [...owner.inputListeners.get('pointerdown')][0];

  let deferredCameraStart;
  moveCamera({ motion: 'pan', direction: 'right' }, (start) => {
    deferredCameraStart = start;
    return { deferred: true };
  });
  let deferredStop;
  moveCamera({ motion: 'stop' }, (stop) => {
    deferredStop = stop;
    return { deferred: true };
  });
  const route = [
    {
      type: 'route',
      path: [
        { lon: 0, lat: 0 },
        { lon: 0.01, lat: 0 },
      ],
    },
  ];
  let deferredRouteStart;
  flyRoute(route, {}, null, (start) => {
    deferredRouteStart = start;
    return { deferred: true };
  });

  assert.equal(disposeCameraVerbs(owner.viewer), true);
  assert.equal(initCameraVerbs(owner.viewer), true);
  assert.equal(startPan().ok, true);
  const currentMotionId = activeCameraMotionId();
  const writesBeforeStaleCallbacks = owner.writes.length;

  retiredTick();
  retiredPointer();
  assert.equal(deferredCameraStart().ok, false);
  assert.equal(deferredRouteStart().ok, false);
  assert.equal(deferredStop().stopped, false);
  assert.equal(owner.writes.length, writesBeforeStaleCallbacks);
  assert.equal(activeCameraMotionId(), currentMotionId);

  tick(owner);
  assert.equal(owner.writes.length, writesBeforeStaleCallbacks + 1);
  assert.equal(disposeCameraVerbs(owner.viewer), true);
});

test('disposed viewers reject deferred camera starts and routes', () => {
  const owner = createViewer();
  initCameraVerbs(owner.viewer);
  let deferredStart;
  const pending = moveCamera({ motion: 'pan', direction: 'left' }, (start) => {
    deferredStart = start;
    return { ok: true, deferred: true };
  });
  assert.equal(pending.deferred, true);
  assert.equal(disposeCameraVerbs(owner.viewer), true);
  assert.equal(
    deferredStart().ok,
    false,
    'late authority callbacks cannot start motion',
  );

  const route = [
    {
      type: 'route',
      path: [
        { lon: 0, lat: 0 },
        { lon: 0.01, lat: 0 },
      ],
    },
  ];
  assert.equal(moveCamera({ motion: 'pan', direction: 'left' }).ok, false);
  assert.equal(flyRoute(route).ok, false);
});

test('application consumers share camera verbs until the scene owner stops them', async () => {
  const owner = createViewer();
  const cleanupOrder = [];
  const app = createApplication({
    createScene({ defer }) {
      initCameraVerbs(owner.viewer);
      defer(() => {
        destroyApplicationSceneViewer(owner.viewer);
      });
      return { viewer: owner.viewer };
    },
    createControls: () => ({}),
    createData({ defer }) {
      initCameraVerbs(owner.viewer);
      defer(() => {
        cleanupOrder.push('data-stop');
        assert.equal(owner.onTick.numberOfListeners, 1);
      });
      return {};
    },
    createTools({ defer }) {
      initCameraVerbs(owner.viewer, () => null);
      defer(() => {
        cleanupOrder.push('tools-stop');
        assert.equal(owner.onTick.numberOfListeners, 1);
      });
      return {};
    },
  });

  const destroyViewer = owner.viewer.destroy.bind(owner.viewer);
  owner.viewer.destroy = () => {
    assert.equal(owner.onTick.numberOfListeners, 0);
    assert.equal(activeCameraMotionId(), 0);
    cleanupOrder.push('camera-verbs-released');
    cleanupOrder.push('viewer-destroy');
    destroyViewer();
  };

  await app.start();
  assert.equal(owner.onTick.numberOfListeners, 1);
  await app.destroy();
  assert.deepEqual(cleanupOrder, [
    'tools-stop',
    'data-stop',
    'camera-verbs-released',
    'viewer-destroy',
  ]);
  assert.equal(owner.viewer.destroyed, true);
});

test('scene viewer cleanup destroys the viewer even when camera listener removal fails', () => {
  const owner = createViewer();
  initCameraVerbs(owner.viewer);
  assert.equal(startPan().ok, true);
  owner.canvas.removeEventListener = () => {
    throw new Error('input listener removal failed');
  };

  assert.throws(
    () => destroyApplicationSceneViewer(owner.viewer),
    (error) =>
      error instanceof AggregateError &&
      error.message === 'Scene viewer cleanup failed' &&
      error.errors.some(
        (cause) => cause?.message === 'Camera verb listener cleanup failed',
      ),
  );
  assert.equal(owner.viewer.destroyed, true);
  assert.equal(owner.onTick.numberOfListeners, 0);
  assert.equal(activeCameraMotionId(), 0);
});
