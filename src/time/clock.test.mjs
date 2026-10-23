import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvestigationClock } from './clock.js';

function fakeTimers() {
  let id = 0;
  const tasks = new Map();
  return {
    schedule(fn, delay) {
      const key = ++id;
      tasks.set(key, { fn, delay });
      return key;
    },
    cancel(key) {
      tasks.delete(key);
    },
    fire() {
      const [key, task] = tasks.entries().next().value || [];
      if (!task) return false;
      tasks.delete(key);
      task.fn();
      return true;
    },
    size: () => tasks.size,
  };
}

test('investigation time pauses and replays independently of wall time', () => {
  let wall = 1_800_000_000_000;
  const timers = fakeTimers();
  const clock = createInvestigationClock({
    now: () => wall,
    monotonicNow: () => wall,
    setTimeout: timers.schedule,
    clearTimeout: timers.cancel,
  });

  assert.equal(clock.getState().mode, 'live');
  assert.equal(clock.now(), wall);
  clock.pause();
  const pausedAt = clock.now();
  wall += 5000;
  assert.equal(clock.now(), pausedAt);
  assert.equal(clock.getState().mode, 'paused');

  clock.play(2);
  wall += 250;
  assert.equal(timers.fire(), true);
  assert.equal(clock.now(), pausedAt + 500);
  assert.equal(clock.getState().mode, 'replay');
  assert.equal(clock.getState().generation, 3);
  clock.destroy();
  assert.equal(timers.size(), 0);
});

test('seek increments the stale-work generation and reverse playback is bounded', () => {
  let wall = 1000;
  const timers = fakeTimers();
  const clock = createInvestigationClock({
    now: () => wall,
    monotonicNow: () => wall,
    setTimeout: timers.schedule,
    clearTimeout: timers.cancel,
  });
  const beforeSeek = clock.getState().generation;
  clock.seek(900);
  assert.equal(clock.getState().targetMs, 900);
  assert.equal(clock.getState().generation, beforeSeek + 1);
  clock.play(-32);
  assert.equal(clock.getState().rate, -16);
  wall += 250;
  timers.fire();
  assert.equal(clock.now(), -3100);
  clock.returnLive();
  assert.equal(clock.now(), wall);
  assert.equal(clock.getState().mode, 'live');
  assert.throws(() => clock.play(0), /nonzero/);
  clock.destroy();
});

test('temporal source metadata follows provider history, local recording, and Live transitions', () => {
  const clock = createInvestigationClock({ now: () => 5000 });
  clock.seek(4000);
  assert.deepEqual(clock.getTemporalContext(), {
    source: 'provider-history',
    targetMs: 4000,
    recordingId: null,
  });
  clock.setTemporalSource('recording', 'aircraft-archive');
  clock.seek(3000);
  assert.deepEqual(clock.getTemporalContext(), {
    source: 'recording',
    targetMs: 3000,
    recordingId: 'aircraft-archive',
  });
  clock.returnLive();
  assert.deepEqual(clock.getTemporalContext(), {
    source: 'live',
    targetMs: null,
    recordingId: null,
  });
  assert.throws(
    () => clock.setTemporalSource('recording', '../bad'),
    /valid local recording/,
  );
  clock.destroy();
});
