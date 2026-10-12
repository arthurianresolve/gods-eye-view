import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import {
  createImportFrameDiagnostics,
  createSceneFrameTimingDiagnostics,
  IMPORT_FRAME_EVENT_LIMIT,
  observeImportFrameHealth,
} from './importFrameDiagnostics.mjs';

test('failure frame timings separate event spans, bound records and dispose ownership', () => {
  let time = 100;
  const events = () => {
    const callbacks = new Set();
    return {
      callbacks,
      addEventListener(callback) {
        callbacks.add(callback);
        return () => callbacks.delete(callback);
      },
      fire() {
        for (const callback of callbacks) callback();
      },
    };
  };
  const scene = Object.fromEntries(
    ['preUpdate', 'postUpdate', 'preRender', 'postRender'].map((name) => [
      name,
      events(),
    ]),
  );
  const trace = createSceneFrameTimingDiagnostics(scene, {
    now: () => time,
    PerformanceObserverClass: null,
  });
  for (let i = 0; i < IMPORT_FRAME_EVENT_LIMIT + 5; i++) {
    scene.preUpdate.fire();
    time += 3;
    scene.postUpdate.fire();
    scene.preRender.fire();
    time += 2000;
    scene.postRender.fire();
  }
  const report = trace.stop();
  assert.equal(report.counts.update, IMPORT_FRAME_EVENT_LIMIT + 5);
  assert.equal(report.spans.update.length, IMPORT_FRAME_EVENT_LIMIT);
  assert.equal(report.spans.render.length, IMPORT_FRAME_EVENT_LIMIT);
  assert.equal(report.spans.update[0].durationMs, 3);
  assert.equal(report.spans.render[0].durationMs, 2000);
  assert.equal(report.overflow.render, true);
  assert.equal(report.entries.longtask, null);
  for (const event of Object.values(scene))
    assert.equal(event.callbacks.size, 0);
  scene.preRender.fire();
  scene.postRender.fire();
  assert.equal(trace.stop(), report);
});

test('failure frame observer drains only current entries and excludes script identities', () => {
  const instances = [];
  class Observer {
    static supportedEntryTypes = ['long-animation-frame', 'longtask'];
    constructor(callback) {
      this.callback = callback;
      instances.push(this);
    }
    observe({ type }) {
      this.type = type;
    }
    takeRecords() {
      return [
        {
          startTime: 110,
          duration: 2100,
          scripts: [
            {
              duration: 2000,
              invokerType: 'user-callback',
              sourceURL: 'https://private/?token=secret',
              sourceFunctionName: 'secret',
            },
          ],
        },
      ];
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const trace = createSceneFrameTimingDiagnostics(
    {},
    { now: () => 100, PerformanceObserverClass: Observer },
  );
  for (const instance of instances)
    instance.callback({ getEntries: () => [{ startTime: 99, duration: 9 }] });
  const report = trace.stop();
  assert.equal(report.entries.longtask.length, 1);
  assert.equal(
    report.entries['long-animation-frame'][0].scripts[0].durationMs,
    2000,
  );
  assert.equal(JSON.stringify(report).includes('secret'), false);
  for (const instance of instances) {
    assert.equal(instance.disconnected, true);
    instance.callback({
      getEntries: () => [{ startTime: 120, duration: 100 }],
    });
  }
  assert.equal(report.entries.longtask.length, 1);
});

test('rejected browser observers remain unavailable and are disconnected', () => {
  let disconnected = 0;
  class Observer {
    static supportedEntryTypes = ['longtask'];
    observe() {
      throw new Error('Unavailable');
    }
    disconnect() {
      disconnected++;
    }
  }
  const trace = createSceneFrameTimingDiagnostics(
    {},
    { now: () => 0, PerformanceObserverClass: Observer },
  );
  assert.equal(trace.stop().entries.longtask, null);
  assert.deepEqual(trace.stop().observerErrors, ['longtask']);
  assert.equal(disconnected, 1);
});

test('scene timing helper is self-contained when serialized into a browser context', () => {
  const callbacks = new Set();
  const event = {
    addEventListener(callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
  };
  let time = 20;
  const scene = Object.fromEntries(
    ['preUpdate', 'postUpdate', 'preRender', 'postRender'].map((name) => [
      name,
      event,
    ]),
  );
  const context = vm.createContext({
    performance: { now: () => time },
    PerformanceObserver: undefined,
  });
  const browserFunction = vm.runInContext(
    `(${createSceneFrameTimingDiagnostics.toString()})`,
    context,
  );
  const installed = browserFunction(scene, {
    maxEntries: 4,
    storeAs: '__gevS47FrameTimingTest',
  });
  assert.equal(installed.status, 'installed');
  assert.equal(
    vm.runInContext(
      'globalThis.__gevS47FrameTimingTest !== undefined',
      context,
    ),
    true,
  );
  event.addEventListener(() => {});
  time += 10;
  const stopped = vm.runInContext(
    'globalThis.__gevS47FrameTimingTest.stop()',
    context,
  );
  assert.equal(stopped.originPerformanceNowMs, 20);
  assert.equal(stopped.elapsedMs, 10);
  assert.equal(stopped.entries.longtask, null);
  assert.equal(callbacks.size, 1);
});

test('scene timing owner does not overwrite an occupied global key', () => {
  const callbacks = new Set();
  const scene = Object.fromEntries(
    ['preUpdate', 'postUpdate', 'preRender', 'postRender'].map((name) => [
      name,
      {
        addEventListener(listener) {
          callbacks.add(listener);
          return () => callbacks.delete(listener);
        },
      },
    ]),
  );
  const existing = { stop() {} };
  globalThis.__gevSceneFrameAlreadyOwned = existing;
  try {
    assert.throws(
      () =>
        createSceneFrameTimingDiagnostics(scene, {
          storeAs: '__gevSceneFrameAlreadyOwned',
        }),
      /owner key is already occupied/,
    );
    assert.equal(globalThis.__gevSceneFrameAlreadyOwned, existing);
    assert.equal(callbacks.size, 0);
  } finally {
    delete globalThis.__gevSceneFrameAlreadyOwned;
  }
});

test('scene timing cleanup attempts every observer and listener after cleanup errors', () => {
  const calls = [];
  const makeEvent = (name, throwOnRemove = false) => ({
    addEventListener() {
      return () => {
        calls.push(name);
        if (throwOnRemove) throw new Error('cleanup failed');
      };
    },
  });
  class Observer {
    static supportedEntryTypes = ['longtask'];

    observe() {}
    takeRecords() {
      return [];
    }
    disconnect() {
      calls.push('observer');
      throw new Error('disconnect failed');
    }
  }
  const scene = {
    preUpdate: makeEvent('preUpdate', true),
    postUpdate: makeEvent('postUpdate'),
    preRender: makeEvent('preRender'),
    postRender: makeEvent('postRender'),
  };
  const trace = createSceneFrameTimingDiagnostics(scene, {
    PerformanceObserverClass: Observer,
  });
  const result = trace.stop();
  assert.deepEqual(calls, [
    'observer',
    'preUpdate',
    'postUpdate',
    'preRender',
    'postRender',
  ]);
  assert.deepEqual(result.cleanupErrors, [
    'observer:longtask',
    'listener:preUpdate',
  ]);
  assert.equal(result.cleanupComplete, false);
  assert.equal(trace.stop(), result);
});

test('partial scene listener installation releases earlier listeners', () => {
  let removed = 0;
  const scene = {
    preUpdate: {
      addEventListener() {
        return () => removed++;
      },
    },
    postUpdate: {
      addEventListener() {
        throw new Error('registration failed');
      },
    },
    preRender: { addEventListener() {} },
    postRender: { addEventListener() {} },
  };
  assert.throws(
    () =>
      createSceneFrameTimingDiagnostics(scene, {
        PerformanceObserverClass: null,
      }),
    /Could not install bounded/,
  );
  assert.equal(removed, 1);
});

test('missing scene event APIs are unavailable rather than reported as zero events', () => {
  const scene = {
    preRender: {
      addEventListener() {
        return () => {};
      },
    },
    postRender: {
      addEventListener() {
        return () => {};
      },
    },
  };
  const result = createSceneFrameTimingDiagnostics(scene, {
    PerformanceObserverClass: null,
  }).stop();
  assert.deepEqual(result.sceneEventAvailability, {
    update: false,
    render: true,
  });
  assert.equal(result.counts.update, null);
  assert.deepEqual(result.spans.update, []);
});

class EventTargetStub {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type);
    listeners?.delete(listener);
    if (!listeners?.size) this.listeners.delete(type);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener();
  }
}

test('frame diagnostics bound lifecycle history, snapshot clipping, and release listeners', () => {
  const windowTarget = Object.assign(new EventTargetStub(), {
    innerWidth: 80,
    innerHeight: 80,
    visualViewport: {
      width: 70,
      height: 60,
      offsetLeft: 3,
      offsetTop: 4,
    },
  });
  const documentTarget = Object.assign(new EventTargetStub(), {
    visibilityState: 'visible',
    hasFocus: () => true,
  });
  let now = 100;
  const diagnostics = createImportFrameDiagnostics({
    windowTarget,
    documentTarget,
    now: () => now,
  });
  const canvas = {
    getBoundingClientRect: () => ({
      left: -10,
      top: 20,
      right: 90,
      bottom: 120,
      width: 100,
      height: 100,
    }),
  };
  assert.deepEqual(diagnostics.snapshotCanvas(canvas), {
    visible: 'visible',
    focused: true,
    viewport: {
      width: 80,
      height: 80,
      visualWidth: 70,
      visualHeight: 60,
      visualOffsetLeft: 3,
      visualOffsetTop: 4,
    },
    canvasRect: {
      left: -10,
      top: 20,
      right: 90,
      bottom: 120,
      width: 100,
      height: 100,
    },
    canvasViewportIntersection: {
      left: 0,
      top: 20,
      right: 80,
      bottom: 80,
      width: 80,
      height: 60,
      area: 4800,
    },
    canvasViewportIntersectionRatio: 0.48,
  });

  windowTarget.dispatch('pagehide');
  assert.equal(diagnostics.events().at(-1).type, 'pagehide');

  for (let index = 0; index < IMPORT_FRAME_EVENT_LIMIT + 8; index++) {
    now++;
    windowTarget.dispatch(index % 2 ? 'focus' : 'blur');
  }
  documentTarget.visibilityState = 'hidden';
  documentTarget.dispatch('visibilitychange');
  const events = diagnostics.events();
  assert.equal(events.length, IMPORT_FRAME_EVENT_LIMIT);
  assert.equal(events.at(-1).type, 'visibilitychange');
  assert.equal(events.at(-1).visible, 'hidden');
  assert.ok(events[0].tMs > 0);

  diagnostics.dispose();
  const eventCount = diagnostics.events().length;
  windowTarget.dispatch('focus');
  windowTarget.dispatch('pageshow');
  assert.equal(diagnostics.events().length, eventCount);
  assert.equal(windowTarget.listeners.size, 0);
  assert.equal(documentTarget.listeners.size, 0);
});

test('post-failure RAF health observer is bounded and releases RAF/timer ownership', async () => {
  let now = 0;
  let nextId = 0;
  const frames = new Map();
  const intervals = new Map();
  const timeouts = new Map();
  const observer = observeImportFrameHealth({
    durationMs: 50,
    now: () => now,
    requestFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    setIntervalFn(callback) {
      const id = ++nextId;
      intervals.set(id, callback);
      return id;
    },
    clearIntervalFn(id) {
      intervals.delete(id);
    },
    setTimeoutFn(callback) {
      const id = ++nextId;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeoutFn(id) {
      timeouts.delete(id);
    },
  });

  const runNextFrame = () => {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback();
  };
  now = 16;
  runNextFrame();
  now = 32;
  runNextFrame();
  now = 36;
  intervals.values().next().value();
  now = 50;
  const deadline = timeouts.values().next().value;
  timeouts.clear();
  deadline();

  assert.deepEqual(await observer, {
    status: 'observed',
    elapsedMs: 50,
    frames: 2,
    firstFrameDelayMs: 16,
    trailingFrameGapMs: 18,
    timerTicks: 1,
    firstTimerDelayMs: 36,
    maximumFrameGapMs: 16,
    maximumTimerGapMs: null,
    trailingTimerGapMs: 14,
  });
  assert.equal(frames.size, 0);
  assert.equal(intervals.size, 0);
  assert.equal(timeouts.size, 0);
});

test('starved RAF is reported as unavailable timing, not a zero-gap pass', async () => {
  let now = 0;
  let nextId = 0;
  const frames = new Map();
  const intervals = new Map();
  const timeouts = new Map();
  const observer = observeImportFrameHealth({
    durationMs: 100,
    now: () => now,
    requestFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    setIntervalFn(callback) {
      const id = ++nextId;
      intervals.set(id, callback);
      return id;
    },
    clearIntervalFn(id) {
      intervals.delete(id);
    },
    setTimeoutFn(callback) {
      const id = ++nextId;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeoutFn(id) {
      timeouts.delete(id);
    },
  });
  now = 100;
  const deadline = timeouts.values().next().value;
  timeouts.clear();
  deadline();

  assert.deepEqual(await observer, {
    status: 'observed',
    elapsedMs: 100,
    frames: 0,
    firstFrameDelayMs: null,
    trailingFrameGapMs: null,
    timerTicks: 0,
    firstTimerDelayMs: null,
    maximumFrameGapMs: null,
    maximumTimerGapMs: null,
    trailingTimerGapMs: null,
  });
  assert.equal(frames.size, 0);
  assert.equal(intervals.size, 0);
  assert.equal(timeouts.size, 0);
});
