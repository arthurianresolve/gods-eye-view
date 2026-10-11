import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { measureSceneWindow } from './measureSceneWindow.mjs';

function harness({ cameraFailure = false, longTasksSupported = true } = {}) {
  let now = 0;
  const renders = new Set();
  const raf = [];
  const timers = new Map();
  const intervals = new Map();
  const listeners = new Set();
  const taskRecords = [];
  const moves = [];
  let observerActive = false;
  const eventTarget = {
    addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener),
  };
  const scene = {
    postRender: {
      addEventListener: (listener) => renders.add(listener),
      removeEventListener: (listener) => renders.delete(listener),
    },
  };
  const context = vm.createContext({
    window: {
      ...eventTarget,
      __godsEyeView: {
        viewer: {
          scene,
          camera: {
            setView() {
              if (cameraFailure) throw new Error('camera failed');
            },
            moveRight: (distance) => moves.push(distance),
          },
        },
      },
      __gevPerformanceHome: {},
      __gevPhasedMonotonicWallClockV1: {
        startMeasurement() {},
        finishMeasurement: () => ({ phase: 'complete', measuredEndMs: now }),
      },
    },
    document: { ...eventTarget, hidden: false, hasFocus: () => true },
    performance: { now: () => now },
    PerformanceObserver: class {
      static supportedEntryTypes = longTasksSupported ? ['longtask'] : [];
      observe() {
        observerActive = true;
      }
      takeRecords() {
        return taskRecords.splice(0);
      }
      disconnect() {
        observerActive = false;
      }
    },
    requestAnimationFrame: (callback) => raf.push(callback),
    setTimeout: (callback) => {
      timers.set(callback, callback);
      return callback;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback) => {
      intervals.set(callback, callback);
      return callback;
    },
    clearInterval: (id) => intervals.delete(id),
  });
  return {
    run(scenarioName = 'idle') {
      return vm.runInContext(
        `(${measureSceneWindow.toString()})(${JSON.stringify({ durationMs: 10, scenarioName, delay: 0 })})`,
        context,
      );
    },
    frame(at) {
      now = at;
      for (const render of renders) render();
    },
    task(duration) {
      if (observerActive) taskRecords.push({ duration });
    },
    end(at) {
      now = at;
      const callback = timers.values().next().value;
      assert.ok(callback);
      timers.delete(callback);
      callback();
    },
    raf(at) {
      now = at;
      const callbacks = raf.splice(0);
      for (const render of renders) render();
      for (const callback of callbacks) callback(at);
    },
    assertClean() {
      assert.equal(renders.size, 0);
      assert.equal(listeners.size, 0);
      assert.equal(timers.size, 0);
      assert.equal(intervals.size, 0);
      assert.equal(observerActive, false);
    },
    moves,
  };
}

const advance = async () => {
  for (let index = 0; index < 4; index++) await Promise.resolve();
};

test('serialized measurement excludes slow settling frames and tasks', async () => {
  const env = harness();
  const pending = env.run();
  env.frame(2);
  env.frame(8);
  env.task(6);
  env.end(10);
  await advance();
  env.frame(70);
  env.task(60);
  env.raf(110);
  const result = await pending;
  assert.equal(result.durationMs, 10);
  assert.equal(result.measurementWindow.settlingElapsedMs, 100);
  assert.equal(result.measurementWindow.includesSettlingFrames, false);
  assert.equal(result.renderedFrameCount, 2);
  assert.equal(result.frameIntervalMs.p95, 6);
  assert.equal(result.longTasks.count, 1);
  assert.equal(result.longTasks.maxMs, 6);
  env.assertClean();
});

test('a delayed measurement timer reports actual elapsed time without clamping', async () => {
  const env = harness();
  const pending = env.run();
  env.frame(2);
  env.frame(30);
  env.end(40);
  await advance();
  env.raf(100);
  const result = await pending;
  assert.equal(result.durationMs, 40);
  assert.equal(result.measurementWindow.requestedDurationMs, 10);
  assert.equal(result.measurementWindow.settlingElapsedMs, 60);
  assert.equal(result.frameIntervalMs.p95, 28);
  assert.equal(result.phasedClockEnd.measuredEndMs, 40);
  env.assertClean();
});

test('absolute motion still reaches its endpoint after timing observers stop', async () => {
  const env = harness();
  const pending = env.run('scripted-motion');
  env.raf(2);
  env.end(10);
  await advance();
  env.raf(50);
  await advance();
  env.raf(100);
  const result = await pending;
  assert.equal(result.durationMs, 10);
  assert.equal(result.cameraPath.motionDistanceM, 3.2);
  assert.equal(env.moves.at(-1), 3.2);
  assert.equal(result.renderedFrameCount, 1);
  assert.equal(result.frameIntervalMs.p95, null);
  env.assertClean();
});

test('measurement errors release timers and every owned timing listener', async () => {
  const env = harness({ cameraFailure: true });
  await assert.rejects(env.run('scripted-motion'), /camera failed/);
  env.assertClean();
});

test('unsupported task timing remains unavailable instead of a measured zero', async () => {
  const env = harness({ longTasksSupported: false });
  const pending = env.run();
  env.end(10);
  await advance();
  env.raf(20);
  const result = await pending;
  assert.equal(result.longTasks.count, null);
  assert.match(result.longTasks.reason, /unavailable/);
  env.assertClean();
});
