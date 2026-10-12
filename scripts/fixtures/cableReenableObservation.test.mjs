import test from 'node:test';
import assert from 'node:assert/strict';
import {
  finishCableReenableObservationSafely,
  startCableReenableObservation,
} from './cableReenableObservation.mjs';

function eventChannel() {
  const listeners = new Set();
  return {
    addEventListener(listener) {
      listeners.add(listener);
    },
    removeEventListener(listener) {
      listeners.delete(listener);
    },
    raise(...args) {
      for (const listener of listeners) listener(...args);
    },
    get size() {
      return listeners.size;
    },
  };
}

function fakeViewer() {
  const canvasListeners = new Map();
  const scene = {
    canvas: {
      addEventListener(name, listener) {
        const values = canvasListeners.get(name) || new Set();
        values.add(listener);
        canvasListeners.set(name, values);
      },
      removeEventListener(name, listener) {
        canvasListeners.get(name)?.delete(listener);
      },
    },
    postRender: eventChannel(),
    renderError: eventChannel(),
    requestRenderMode: false,
    frameState: { frameNumber: 0 },
    primitives: null,
    groundPrimitives: null,
  };
  return {
    viewer: { scene, useDefaultRenderLoop: true },
    canvasListeners,
  };
}

test('captures actual timer receipt gaps separately from postRender time', () => {
  const { viewer } = fakeViewer();
  let now = 100;
  let callback;
  let cleared = false;
  const observer = startCableReenableObservation({
    viewer,
    Cesium: { VERSION: 'unsupported-test-version' },
    documentTarget: { visibilityState: 'visible', hasFocus: () => true },
    now: () => now,
    setIntervalFn: (fn, interval) => {
      assert.equal(interval, 250);
      callback = fn;
      return 7;
    },
    clearIntervalFn: (id) => {
      assert.equal(id, 7);
      cleared = true;
    },
  });
  assert.equal(typeof callback, 'function');
  assert.equal(viewer.scene.postRender.size, 1);
  now = 120;
  viewer.scene.postRender.raise();
  now = 350;
  callback();
  now = 620;
  callback();
  const result = observer.finish('failed');
  assert.equal(result.status, 'failed');
  assert.equal(result.sampleCount, 4);
  assert.equal(result.samples[1].receivedAtMonotonicMs, 350);
  assert.equal(result.samples[1].receivedAtMs, 250);
  assert.equal(result.samples[1].receiptGapMs, 250);
  assert.equal(result.samples[1].lastPostRenderAtMs, 20);
  assert.equal(result.samples[1].lastPostRenderMonotonicMs, 120);
  assert.equal(result.samples[1].postRenderAgeMs, 230);
  assert.equal(result.samples[2].receiptGapMs, 270);
  assert.equal(result.lastPostRenderAtMs, 20);
  assert.equal(result.samples[1].primitiveReadiness.available, true);
  assert.equal(result.samples[1].primitiveReadiness.ready, true);
  assert.equal(result.samples[1].page.visibilityState.value, 'visible');
  assert.equal(result.samples[1].page.hasFocus.value, true);
  assert.equal(cleared, true);
  assert.equal(viewer.scene.postRender.size, 0);
  assert.equal(viewer.scene.renderError.size, 0);
});

test('retains render errors and context-loss events without requesting renders', () => {
  const { viewer, canvasListeners } = fakeViewer();
  let now = 10;
  let callback;
  let renderRequests = 0;
  viewer.scene.requestRender = () => renderRequests++;
  const observer = startCableReenableObservation({
    viewer,
    Cesium: { VERSION: 'unsupported-test-version' },
    documentTarget: {},
    now: () => now,
    setIntervalFn: (fn) => {
      callback = fn;
      return 1;
    },
    clearIntervalFn: () => {},
  });
  now = 20;
  viewer.scene.renderError.raise(viewer.scene, {
    name: 'RuntimeError',
    message: 'bad at https://private.example/data and C:\\secret\\file.js',
  });
  for (const listener of canvasListeners.get('webglcontextlost') || [])
    listener();
  callback();
  const result = observer.finish('completed');
  assert.equal(result.renderErrorCount, 1);
  assert.match(result.renderErrors[0].error.message, /\[url\]/);
  assert.match(result.renderErrors[0].error.message, /\[path\]/);
  assert.equal(result.contextEvents.lostEvents, 1);
  assert.equal(result.samples.at(-1).context.lostEvents, 1);
  assert.equal(renderRequests, 0);
  assert.equal(result.samples[0].context.isLost, null);
  assert.equal(result.samples[1].context.isLost, true);
});

test('bounds snapshots and keeps the first observations plus recent tail', () => {
  const { viewer } = fakeViewer();
  let now = 0;
  let callback;
  const observer = startCableReenableObservation({
    viewer,
    Cesium: { VERSION: 'unsupported-test-version' },
    documentTarget: { visibilityState: 'hidden' },
    now: () => now,
    setIntervalFn: (fn) => {
      callback = fn;
      return 2;
    },
    clearIntervalFn: () => {},
  });
  for (let index = 1; index <= 80; index += 1) {
    now += 250;
    viewer.scene.frameState.frameNumber = index;
    callback();
  }
  const result = observer.finish();
  assert.equal(result.sampleCount, 82);
  assert.equal(result.samples.length, 64);
  assert.equal(result.samplesTruncated, true);
  assert.equal(result.samples[0].sequence, 1);
  assert.equal(result.samples[1].sequence, 2);
  assert.equal(result.samples.at(-1).sequence, 82);
  assert.equal(result.samples.at(-1).renderLoop.frameNumber.value, 80);
  assert.equal(result.samples.at(-1).snapshotKind, 'finish');
});

test('missing render-loop and focus APIs remain explicitly unavailable', () => {
  const { viewer } = fakeViewer();
  delete viewer.useDefaultRenderLoop;
  let callback;
  const observer = startCableReenableObservation({
    viewer,
    Cesium: { VERSION: 'unsupported-test-version' },
    documentTarget: { visibilityState: 'visible' },
    now: () => 1,
    setIntervalFn: (fn) => {
      callback = fn;
      return 3;
    },
    clearIntervalFn: () => {},
  });
  callback();
  const result = observer.finish();
  assert.equal(
    result.samples[0].renderLoop.useDefaultRenderLoop.available,
    false,
  );
  assert.equal(
    result.samples[0].renderLoop.useDefaultRenderLoop.reason,
    'unsupported-cesium-version',
  );
  assert.equal(result.samples[0].page.hasFocus.available, false);
  assert.equal(result.samples[0].page.hasFocus.reason, 'not-supported');
});

test('supported Cesium version still reports absent render fields unavailable', () => {
  const { viewer } = fakeViewer();
  delete viewer.useDefaultRenderLoop;
  delete viewer.scene.requestRenderMode;
  viewer.scene.frameState = {};
  let callback;
  const observer = startCableReenableObservation({
    viewer,
    Cesium: { VERSION: '1.138.0' },
    documentTarget: {},
    now: () => 100,
    setIntervalFn: (fn) => {
      callback = fn;
      return 4;
    },
    clearIntervalFn: () => {},
  });
  callback();
  const row = observer.finish().samples[0];
  assert.equal(row.renderLoop.useDefaultRenderLoop.available, false);
  assert.equal(row.renderLoop.requestRenderMode.available, false);
  assert.equal(row.renderLoop.frameNumber.available, false);
  assert.equal(row.page.visibilityState.available, false);
});

test('safe finalization preserves the primary failure and finish is idempotent', () => {
  const primary = new Error('primary readiness timeout');
  const finalization = finishCableReenableObservationSafely(
    {
      finish() {
        throw new Error('diagnostic failure');
      },
    },
    'failed',
    primary,
  );
  assert.equal(finalization.status, 'finalization-failed');
  assert.equal(finalization.primaryLifecycleFailurePreserved, true);
  assert.equal(finalization.finishError.message, 'diagnostic failure');

  const { viewer } = fakeViewer();
  let callback;
  const observer = startCableReenableObservation({
    viewer,
    Cesium: { VERSION: 'unsupported-test-version' },
    documentTarget: {},
    now: () => 10,
    setIntervalFn: (fn) => {
      callback = fn;
      return 5;
    },
    clearIntervalFn: () => {},
  });
  callback();
  const finished = observer.finish('failed');
  assert.equal(finished.samples.at(-1).snapshotKind, 'finish');
  assert.equal(observer.finish('completed'), finished);
});

test('timer setup failure removes listeners already owned by the observer', () => {
  const { viewer } = fakeViewer();
  assert.throws(
    () =>
      startCableReenableObservation({
        viewer,
        Cesium: { VERSION: '1.138.0' },
        documentTarget: {},
        now: () => 10,
        setIntervalFn: () => {
          throw new Error('timer unavailable');
        },
        clearIntervalFn: () => {},
      }),
    /timer unavailable/,
  );
  assert.equal(viewer.scene.postRender.size, 0);
  assert.equal(viewer.scene.renderError.size, 0);
});
