import assert from 'node:assert/strict';
import test from 'node:test';
import { observeFleetTiming } from './fleet-timing-trace.mjs';

function fixture() {
  let clock = 0;
  let nextHandle = 0;
  const callbacks = new Map();
  const timers = {
    setTimeout(callback, delay, ...args) {
      const handle = ++nextHandle;
      callbacks.set(handle, () => callback.apply(timers, args));
      return handle;
    },
    clearTimeout(handle) {
      callbacks.delete(handle);
    },
  };
  const listeners = new Map();
  const prototype = {
    initializeFrame(value) {
      assert.equal(this, scene);
      return value;
    },
    requestRender() {
      scene.requested = true;
    },
  };
  const scene = Object.create(prototype);
  for (const phase of ['preUpdate', 'postUpdate', 'preRender', 'postRender']) {
    const set = new Set();
    listeners.set(phase, set);
    scene[phase] = {
      addEventListener(cb) {
        set.add(cb);
        return () => set.delete(cb);
      },
    };
  }
  return {
    scene,
    timers,
    callbacks,
    listeners,
    now: () => clock,
    time: (v) => {
      clock = v;
    },
  };
}

test('timing observer retains timer/scene semantics and records separate frame stages', () => {
  const f = fixture();
  const originalSet = f.timers.setTimeout;
  const trace = observeFleetTiming(f);
  let received;
  const handle = f.timers.setTimeout(
    function (...args) {
      assert.equal(this, f.timers);
      received = args;
      f.scene.requestRender();
      f.time(85);
      return 17;
    },
    80,
    'value',
  );
  f.time(82);
  assert.equal(f.callbacks.get(handle)(), 17);
  assert.deepEqual(received, ['value']);
  assert.equal(f.scene.initializeFrame('unchanged'), 'unchanged');
  for (const callbacks of f.listeners.values())
    for (const cb of callbacks) cb();
  const result = trace.stop();
  assert.deepEqual(
    result.events.find((e) => e.kind === 'timer-scheduled'),
    {
      kind: 'timer-scheduled',
      at: 0,
      id: 1,
      owner: 'other',
      scheduledAt: 0,
      dueAt: 80,
    },
  );
  assert.equal(result.events.find((e) => e.kind === 'timer-start').at, 82);
  assert.equal(result.events.find((e) => e.kind === 'timer-end').at, 85);
  assert.ok(result.events.some((e) => e.kind === 'postRender'));
  assert.equal(f.timers.setTimeout, originalSet);
  assert.equal(Object.hasOwn(f.scene, 'initializeFrame'), false);
  assert.ok([...f.listeners.values()].every((set) => set.size === 0));
  assert.equal(trace.stop(), result);
});

test('bounded observer does not cancel application timers and late callbacks stay unobserved', () => {
  const f = fixture();
  const trace = observeFleetTiming({ ...f, maxEvents: 2 });
  let calls = 0;
  const cancelled = f.timers.setTimeout(
    () => assert.fail('cancelled callback'),
    10,
  );
  f.timers.clearTimeout(cancelled);
  const live = f.timers.setTimeout(() => calls++, 20);
  trace.stop();
  assert.equal(f.callbacks.has(live), true);
  f.callbacks.get(live)();
  assert.equal(calls, 1);
  assert.equal(trace.report.events.length, 2);
  assert.equal(trace.report.truncated, true);
});

test('exceptions propagate and teardown does not overwrite a later owner', () => {
  const f = fixture();
  const trace = observeFleetTiming(f);
  const error = new Error('fixture failure');
  const handle = f.timers.setTimeout(() => {
    throw error;
  }, 1);
  assert.throws(
    () => f.callbacks.get(handle)(),
    (e) => e === error,
  );
  const later = () => 'new owner';
  f.scene.requestRender = later;
  trace.stop();
  assert.equal(f.scene.requestRender, later);
  assert.ok(trace.report.events.some((e) => e.kind === 'timer-end'));
});

test('partial installation failure restores already installed wrappers', () => {
  const f = fixture();
  const originalSet = f.timers.setTimeout;
  const originalClear = f.timers.clearTimeout;
  Object.defineProperty(f.scene, 'requestRender', {
    value: () => {},
    writable: false,
  });
  assert.throws(() => observeFleetTiming(f), TypeError);
  assert.equal(f.timers.setTimeout, originalSet);
  assert.equal(f.timers.clearTimeout, originalClear);
  assert.equal(Object.hasOwn(f.scene, 'initializeFrame'), false);
  assert.ok([...f.listeners.values()].every((set) => set.size === 0));
});
