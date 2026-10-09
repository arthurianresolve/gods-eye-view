import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createImportFrameDiagnostics,
  IMPORT_FRAME_EVENT_LIMIT,
  observeImportFrameHealth,
} from './importFrameDiagnostics.mjs';

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
