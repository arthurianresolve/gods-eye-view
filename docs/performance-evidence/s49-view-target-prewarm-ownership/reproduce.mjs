import * as Cesium from 'cesium';
import { execFileSync } from 'node:child_process';
import { createGevActionRunner } from '../../../src/voice/gevActions.js';

const outcomes = [];
for (const stage of ['debounce-pending', 'idle-pending']) {
  const timers = new Map();
  const idle = new Map();
  let sequence = 0;
  let picks = 0;
  const moveEnd = new Cesium.Event();
  globalThis.window = {
    setTimeout(fn) {
      const id = ++sequence;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback(fn) {
      const id = ++sequence;
      idle.set(id, fn);
      return id;
    },
    cancelIdleCallback(id) { idle.delete(id); },
  };
  const point = Cesium.Cartesian3.fromDegrees(-97.74, 30.26, 0);
  const position = Cesium.Cartesian3.fromDegrees(-97.74, 30.26, 900_000);
  const viewer = {
    clock: { onTick: new Cesium.Event() },
    camera: {
      moveEnd,
      positionWC: position,
      positionCartographic: Cesium.Cartographic.fromCartesian(position),
      heading: 0,
      pitch: -1,
      pickEllipsoid() { return point; },
      getPickRay() { return null; },
      cancelFlight() {},
      flyToBoundingSphere() {},
      lookAtTransform() {},
    },
    scene: {
      canvas: {
        clientWidth: 1200,
        clientHeight: 800,
        addEventListener() {},
        removeEventListener() {},
      },
      tweens: [],
      pickPositionSupported: true,
      pickPosition() { picks++; return point; },
    },
  };
  const runner = createGevActionRunner({
    viewer,
    styleManager: {},
    dataManager: { layers: new Map(), isEnabled: () => false, getAll: () => [] },
  });
  const snapshot = () => ({ listeners: moveEnd.numberOfListeners, timers: timers.size, idle: idle.size, picks });
  const flush = (queue) => {
    for (const [id, fn] of [...queue]) {
      queue.delete(id);
      fn({ didTimeout: false, timeRemaining: () => 20 });
    }
  };
  moveEnd.raiseEvent();
  if (stage === 'idle-pending') flush(timers);
  const before = snapshot();
  runner.dispose();
  const afterDispose = snapshot();
  flush(timers);
  flush(idle);
  outcomes.push({ stage, before, afterDispose, afterDrain: snapshot(), latePickAfterDispose: picks > 0 });
}
console.log(JSON.stringify({
  schema: 'gev-prewarm-disposal-reproduction/v1',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: 'Actual action-runner disposal and Cesium event; deterministic queued callbacks. No browser latency or full-soak claim.',
  expected: { listenersAfterDispose: 0, pendingCallbacksAfterDispose: 0, picksAfterDrain: 0 },
  outcomes,
}, null, 2));
