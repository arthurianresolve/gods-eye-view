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
