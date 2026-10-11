import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { consumeInBatches } from './cooperative.js';

test('every exit releases the abort listener, timer and iterator ownership', async () => {
  for (const exit of [
    'success',
    'abort',
    'iterator-error',
    'scheduler-error',
  ]) {
    const controller = new AbortController();
    const timers = new Map();
    let clock = 0,
      closed = false;
    function* work() {
      try {
        for (let i = 0; i < 4; i++) {
          if (exit === 'iterator-error') throw new Error('bad geometry');
          clock += 4;
          yield;
        }
        return 4;
      } finally {
        closed = true;
      }
    }
    const promise = consumeInBatches(work(), {
      signal: controller.signal,
      now: () => clock,
      schedule(fn) {
        if (exit === 'scheduler-error') throw new Error('timer unavailable');
        timers.set(1, fn);
        return 1;
      },
      cancel(id) {
        timers.delete(id);
      },
    });
    const observed = exit === 'success' ? promise : assert.rejects(promise);
    if (exit === 'abort') controller.abort();
    while (timers.size) {
      const fn = timers.get(1);
      timers.delete(1);
      fn();
    }
    if (exit === 'success') assert.equal(await observed, 4);
    else await observed;
    assert.equal(closed, true, exit);
    assert.equal(timers.size, 0, exit);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0, exit);
  }
});

test('already aborted input never starts work', async () => {
  let started = false;
  function* work() {
    started = true;
    yield;
  }
  await assert.rejects(
    consumeInBatches(work(), { signal: AbortSignal.abort() }),
    { name: 'AbortError' },
  );
  assert.equal(started, false);
});

test('deferred start is owned and cancelled before iterator work begins', async () => {
  const controller = new AbortController();
  const timers = new Map();
  let started = false;
  let closed = false;
  function* work() {
    try {
      started = true;
      yield;
    } finally {
      closed = true;
    }
  }
  const pending = consumeInBatches(work(), {
    signal: controller.signal,
    deferStart: true,
    schedule(fn) {
      timers.set(1, fn);
      return 1;
    },
    cancel(id) {
      timers.delete(id);
    },
  });
  assert.equal(started, false);
  assert.equal(timers.size, 1);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(started, false);
  assert.equal(closed, false);
  assert.equal(timers.size, 0);
});

test('default start remains synchronous for existing consumers', async () => {
  let started = false;
  function* work() {
    started = true;
    yield;
  }
  const pending = consumeInBatches(work());
  assert.equal(started, true);
  await pending;
});

test('optional batch observation measures owned wakes without replacing the scheduler', async () => {
  let clock = 0;
  const queued = [];
  const observations = [];
  function* work() {
    clock++;
    yield;
    clock++;
    yield;
    return 'complete';
  }
  const pending = consumeInBatches(work(), {
    budgetMs: 1,
    now: () => clock,
    schedule(callback) {
      const handle = { backend: 'controlled-task', callback };
      queued.push(handle);
      return handle;
    },
    cancel(handle) {
      const index = queued.indexOf(handle);
      if (index >= 0) queued.splice(index, 1);
    },
    onBatch(observation) {
      observations.push(observation);
    },
  });
  while (queued.length) queued.shift().callback();
  assert.equal(await pending, 'complete');
  assert.equal(observations.length, 3);
  assert.equal(observations[0].schedulerBackend, 'injected');
  assert.equal(observations[0].enqueueToWakeMs, null);
  assert.equal(observations[1].schedulerBackend, 'controlled-task');
  assert.equal(observations[1].enqueueToWakeMs, 0);
  assert.equal(observations[1].budgetMs, 1);
  assert.equal(observations[1].yielded, true);
  assert.equal(observations[2].yielded, false);
});

test('optional step observation reports bounded iterator work without changing results', async () => {
  let clock = 0;
  const queued = [];
  const steps = [];
  function* work() {
    clock += 2;
    yield 'entity';
    clock += 5;
    yield 'coordinate-chunk';
    clock += 1;
    return 'complete';
  }
  const pending = consumeInBatches(work(), {
    budgetMs: 4,
    now: () => clock,
    schedule(callback) {
      queued.push(callback);
      return callback;
    },
    cancel(callback) {
      const index = queued.indexOf(callback);
      if (index >= 0) queued.splice(index, 1);
    },
    onStep(activeMs, stage, interval) {
      steps.push({ activeMs, stage, interval });
    },
  });
  while (queued.length) queued.shift()();
  assert.equal(await pending, 'complete');
  assert.deepEqual(steps, [
    { activeMs: 2, stage: 'entity', interval: { startMs: 0, endMs: 2 } },
    {
      activeMs: 5,
      stage: 'coordinate-chunk',
      interval: { startMs: 2, endMs: 7 },
    },
    { activeMs: 1, stage: 'completed', interval: { startMs: 7, endMs: 8 } },
  ]);
});

test('cancellation from a batch observer cannot enqueue another wake', async () => {
  for (const deferStart of [false, true]) {
    const controller = new AbortController();
    const queued = new Set();
    let clock = 0;
    let closed = false;
    function* work() {
      try {
        clock += 4;
        yield;
        assert.fail('Cancelled geometry resumed');
      } finally {
        closed = true;
      }
    }
    const pending = consumeInBatches(work(), {
      signal: controller.signal,
      deferStart,
      now: () => clock,
      schedule(callback) {
        queued.add(callback);
        return callback;
      },
      cancel(callback) {
        queued.delete(callback);
      },
      onBatch() {
        controller.abort();
      },
    });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    if (deferStart) {
      const callback = [...queued][0];
      queued.delete(callback);
      callback();
    }
    await rejected;
    assert.equal(closed, true);
    assert.equal(
      queued.size,
      0,
      'Cancelled work must not retain a queued wake',
    );
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});
