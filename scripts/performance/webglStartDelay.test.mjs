import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartDelay } from '../fixtures/webglStartDelay.mjs';

function target(initial = {}) {
  const listeners = new Map();
  return {
    ...initial,
    listeners,
    addEventListener(type, listener) {
      const entries = listeners.get(type) || new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      for (const listener of listeners.get(type) || []) listener();
    },
    listenerCount() {
      return [...listeners.values()].reduce(
        (sum, entries) => sum + entries.size,
        0,
      );
    },
  };
}

function fixture() {
  let nowMs = 100;
  let timerCallback = null;
  let timerDelay = null;
  const cleared = [];
  const win = target({ innerWidth: 894, innerHeight: 585 });
  const doc = target({
    visibilityState: 'visible',
    hasFocus: () => true,
  });
  const control = createStartDelay({
    delayMs: 10_000,
    now: () => nowMs,
    setTimer(callback, delay) {
      timerCallback = callback;
      timerDelay = delay;
      return 7;
    },
    clearTimer(id) {
      cleared.push(id);
      timerCallback = null;
    },
    windowTarget: win,
    documentTarget: doc,
  });
  return {
    control,
    win,
    doc,
    cleared,
    get timerDelay() {
      return timerDelay;
    },
    set now(value) {
      nowMs = value;
    },
    fireTimer() {
      const callback = timerCallback;
      timerCallback = null;
      callback?.();
    },
  };
}

test('preparation delay records requested/actual time and changed conditions, then releases ownership', async () => {
  const f = fixture();
  assert.equal(f.timerDelay, 10_000);
  f.now = 250;
  f.win.emit('blur');
  f.doc.visibilityState = 'hidden';
  f.doc.emit('visibilitychange');
  f.win.innerWidth = 800;
  f.win.emit('resize');
  f.now = 10_100;
  f.fireTimer();

  const report = await f.control.promise;
  assert.equal(report.requestedDelayMs, 10_000);
  assert.equal(report.actualDelayMs, 10_000);
  assert.equal(report.outcome, 'elapsed');
  assert.deepEqual(report.changes, {
    focus: true,
    visibility: true,
    viewport: true,
  });
  assert.equal(report.started.focused, true);
  assert.equal(report.completed.focused, true);
  assert.equal(report.started.visibility, 'visible');
  assert.equal(report.completed.visibility, 'hidden');
  assert.equal(report.completed.viewport.width, 800);
  assert.deepEqual(f.cleared, [7]);
  assert.equal(f.win.listenerCount() + f.doc.listenerCount(), 0);
});

test('cancel and pagehide settle once and remove the timer and every listener', async () => {
  for (const [cancel, expectedReason] of [
    [(f) => f.control.cancel('user-cancelled'), 'user-cancelled'],
    [(f) => f.win.emit('pagehide'), 'pagehide'],
  ]) {
    const f = fixture();
    cancel(f);
    f.control.cancel('second-cancel');
    f.fireTimer();
    const report = await f.control.promise;
    assert.equal(report.outcome, 'cancelled');
    assert.equal(report.cancelReason, expectedReason);
    assert.deepEqual(f.cleared, [7]);
    assert.equal(f.win.listenerCount() + f.doc.listenerCount(), 0);
  }
});

test('listener setup failure releases listeners already attached and never leaves a timer', () => {
  const win = target({ innerWidth: 800, innerHeight: 600 });
  const doc = target({ visibilityState: 'visible', hasFocus: () => true });
  doc.addEventListener = () => {
    throw new Error('listener setup failed');
  };
  let timers = 0;
  assert.throws(
    () =>
      createStartDelay({
        delayMs: 10_000,
        windowTarget: win,
        documentTarget: doc,
        setTimer() {
          timers++;
          return 1;
        },
        clearTimer() {},
      }),
    /listener setup failed/,
  );
  assert.equal(win.listenerCount(), 0);
  assert.equal(timers, 0);
});

test('timer creation failure releases all temporary listeners', () => {
  const win = target({ innerWidth: 800, innerHeight: 600 });
  const doc = target({ visibilityState: 'visible', hasFocus: () => true });
  assert.throws(
    () =>
      createStartDelay({
        delayMs: 10_000,
        windowTarget: win,
        documentTarget: doc,
        setTimer() {
          throw new Error('timer setup failed');
        },
        clearTimer() {},
      }),
    /timer setup failed/,
  );
  assert.equal(win.listenerCount() + doc.listenerCount(), 0);
});

test('delay is bounded and duplicate settlement cannot create a second start', async () => {
  const f = fixture();
  assert.throws(
    () =>
      createStartDelay({
        delayMs: 10_001,
        windowTarget: f.win,
        documentTarget: f.doc,
      }),
    /between 1 and 10000/,
  );
  f.now = 10_100;
  f.fireTimer();
  f.control.cancel();
  assert.equal((await f.control.promise).outcome, 'elapsed');
});

test('unavailable focus APIs remain null instead of being reported as unfocused', async () => {
  const win = target({ innerWidth: 640, innerHeight: 360 });
  const doc = target({ visibilityState: 'visible' });
  delete doc.hasFocus;
  let timerCallback;
  const control = createStartDelay({
    delayMs: 1,
    now: () => 10,
    setTimer(callback) {
      timerCallback = callback;
      return 1;
    },
    clearTimer() {},
    windowTarget: win,
    documentTarget: doc,
  });
  timerCallback();
  const report = await control.promise;
  assert.equal(report.started.focused, null);
  assert.equal(report.completed.focused, null);
});
