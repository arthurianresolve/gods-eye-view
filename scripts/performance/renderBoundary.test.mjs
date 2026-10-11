import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { settlePageRenderBoundary } from './renderBoundary.mjs';
import { settleCompletedRender } from './productionFlightFixture.mjs';

function clock(t) {
  let now = 0,
    nextId = 0;
  const timers = new Map();
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => {
    const id = ++nextId;
    timers.set(id, { fn, at: now + delay });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', (id) => timers.delete(id));
  return {
    timers,
    advance(ms, deliver = true) {
      now += ms;
      if (deliver)
        for (const [id, timer] of [...timers]) {
          if (timer.at <= now) {
            timers.delete(id);
            timer.fn();
          }
        }
    },
  };
}

function page() {
  const target = new EventEmitter();
  let resolve, reject;
  const result = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  target.evaluate = (fn, ...args) => {
    assert.equal(fn, settleCompletedRender);
    target.mode = args[3];
    target.id = args[4];
    return result;
  };
  target.event = (phase, boundaryId = target.id) =>
    target.emit('console', {
      text: () =>
        '[gev-render-boundary] ' +
        JSON.stringify({ phase, boundaryId, pageNowMs: performance.now() }),
    });
  target.resolve = resolve;
  target.reject = reject;
  return target;
}

test('queued callback receives a separate bound without consuming the render allowance', async (t) => {
  const time = clock(t),
    target = page(),
    diagnostic = {};
  const pending = settlePageRenderBoundary(target, { diagnostic });
  assert.equal(
    target.mode,
    'entry',
    'non-verbose captures need only one phase event',
  );
  time.advance(4250);
  target.event('entered');
  time.advance(4000);
  target.resolve({ settleElapsedMs: 4000 });
  assert.deepEqual(await pending, { settleElapsedMs: 4000 });
  assert.equal(diagnostic.entryElapsedMs, 4250);
  assert.equal(diagnostic.hostElapsedMs, 8250);
  assert.equal(target.listenerCount('console'), 0);
  assert.equal(time.timers.size, 0);
});

test('missing callback entry times out and removes host ownership', async (t) => {
  const time = clock(t),
    target = page();
  const pending = settlePageRenderBoundary(target);
  const failed = assert.rejects(
    pending,
    /callback did not enter within 5000ms/,
  );
  time.advance(5000);
  await failed;
  target.event('entered');
  target.reject(new Error('late protocol failure'));
  assert.equal(time.timers.size, 0);
  assert.equal(target.listenerCount('console'), 0);
});

test('delayed host timers do not admit an overdue callback entry', async (t) => {
  const time = clock(t),
    target = page();
  const pending = settlePageRenderBoundary(target);
  const failed = assert.rejects(pending, /entry exceeded 5000ms/);
  time.advance(5001, false);
  target.event('entered');
  target.resolve({ settleElapsedMs: 0 });
  await failed;
  assert.equal(time.timers.size, 0);
});

test('draw result delivery is bounded after entry; duplicate and other-owner events cannot reset it', async (t) => {
  const time = clock(t),
    target = page(),
    diagnostic = {};
  const pending = settlePageRenderBoundary(target, {
    diagnostic,
    verbose: true,
  });
  const failed = assert.rejects(pending, /result was not delivered/);
  target.event('entered', 'discarded-document');
  assert.equal(diagnostic.entryElapsedMs, null);
  time.advance(300);
  target.event('entered');
  time.advance(5900);
  target.event('entered');
  target.event('preRender', 'discarded-document');
  time.advance(100);
  await failed;
  assert.equal(diagnostic.entryElapsedMs, 300);
  assert.equal(target.listenerCount('console'), 0);
  assert.equal(time.timers.size, 0);
});

test('late host result cannot win over a delayed delivery timer', async (t) => {
  const time = clock(t),
    target = page();
  const pending = settlePageRenderBoundary(target);
  const failed = assert.rejects(pending, /exceeded its delivery deadline/);
  target.event('entered');
  time.advance(6001, false);
  target.resolve({ settleElapsedMs: 100 });
  await failed;
  assert.equal(time.timers.size, 0);
});

test('host rejects missing entry, overdue or unavailable page durations', async (t) => {
  const time = clock(t);
  for (const value of [undefined, -1, Infinity, 5001, '10', 10]) {
    const target = page();
    const pending = settlePageRenderBoundary(target);
    if (value !== 10) target.event('entered');
    target.resolve({ settleElapsedMs: value });
    await assert.rejects(pending, /page deadline|no timely callback entry/);
    assert.equal(target.listenerCount('console'), 0);
    assert.equal(time.timers.size, 0);
  }
});

test('protocol failure and synchronous dispatch failure retain their cause and clean up', async (t) => {
  const time = clock(t);
  for (const sync of [false, true]) {
    const target = page();
    if (sync)
      target.evaluate = () => {
        throw new Error('dispatch failed');
      };
    const pending = settlePageRenderBoundary(target);
    if (!sync) target.reject(new Error('dispatch failed'));
    await assert.rejects(pending, /dispatch failed/);
    assert.equal(target.listenerCount('console'), 0);
    assert.equal(time.timers.size, 0);
  }
});

test('bounded diagnostics ignore malformed, unknown and other-owner events', async (t) => {
  const time = clock(t),
    target = page(),
    diagnostic = {};
  const pending = settlePageRenderBoundary(target, { diagnostic });
  target.emit('console', { text: () => '[gev-render-boundary] {' });
  target.event('unexpected');
  target.event('entered', 'old-owner');
  assert.equal(diagnostic.events.length, 0);
  target.event('entered');
  for (let i = 0; i < 30; i++) target.event('preUpdate');
  target.resolve({ settleElapsedMs: 0 });
  await pending;
  assert.equal(diagnostic.events.length, 12);
  assert.equal(time.timers.size, 0);
});

test('page rejects late postRender even when its timeout callback is blocked', async (t) => {
  const time = clock(t);
  const listeners = new Set();
  const phases = [];
  t.mock.method(console, 'info', (line) =>
    phases.push(JSON.parse(line.slice('[gev-render-boundary] '.length))),
  );
  const viewer = {
    scene: {
      postRender: {
        addEventListener(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      requestRender() {},
    },
  };
  const pending = settleCompletedRender(viewer, 5000, null, true, 'test-owner');
  const failed = assert.rejects(pending, /did not settle/);
  time.advance(5001, false);
  for (const listener of [...listeners]) listener();
  await failed;
  assert.equal(phases.at(-1).phase, 'timeout');
  assert.ok(phases.every((row) => row.boundaryId === 'test-owner'));
  assert.equal(listeners.size, 0);
  assert.equal(time.timers.size, 0);
});

test('entry-only page signal does not install update diagnostics or change render output', async (t) => {
  const time = clock(t),
    phases = [],
    listeners = new Set();
  t.mock.method(console, 'info', (line) =>
    phases.push(JSON.parse(line.slice('[gev-render-boundary] '.length)).phase),
  );
  const viewer = {
    scene: {
      preUpdate: {
        addEventListener() {
          assert.fail('unrequested update observer');
        },
      },
      postRender: {
        addEventListener(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      requestRender() {},
    },
  };
  const pending = settleCompletedRender(
    viewer,
    5000,
    null,
    'entry',
    'entry-owner',
  );
  time.advance(100);
  for (const listener of [...listeners]) listener();
  assert.deepEqual(await pending, { settleElapsedMs: 100 });
  assert.deepEqual(phases, ['entered']);
  assert.equal(listeners.size, 0);
  assert.equal(time.timers.size, 0);
});
