import assert from 'node:assert/strict';
import test from 'node:test';

import { runSceneMeasurementWithHostDeadline } from './sceneMeasurementDeadline.mjs';

function controlledClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    timerCount: () => timers.size,
  };
}

test('scene measurement returns normally and clears its host timer', async () => {
  const clock = controlledClock();
  const observations = [];
  const result = await runSceneMeasurementWithHostDeadline({
    evaluate: async () => ({ frameCount: 42 }),
    measurementMs: 100,
    hostGraceMs: 25,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onProgress: (observation) => observations.push(observation),
  });

  assert.deepEqual(result, { frameCount: 42 });
  assert.equal(clock.timerCount(), 0);
  assert.equal(observations.at(-1).status, 'completed');
  assert.equal(observations.at(-1).cleanup.hostTimerCleared, true);
});

test('scene measurement fails on its own host deadline before protocol timeout', async () => {
  const clock = controlledClock();
  const observations = [];
  const pending = runSceneMeasurementWithHostDeadline({
    evaluate: () => new Promise(() => {}),
    measurementMs: 100,
    hostGraceMs: 25,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onProgress: (observation) => observations.push(observation),
  });
  await Promise.resolve();
  clock.advance(125);

  await assert.rejects(pending, (error) => {
    assert.equal(error.name, 'TimeoutError');
    assert.equal(error.sceneMeasurementObservation.status, 'host-deadline');
    assert.equal(
      error.sceneMeasurementObservation.pageEvaluationPendingAtDeadline,
      true,
    );
    assert.equal(
      error.sceneMeasurementObservation.cleanup.pageEvaluationRetirement,
      'pending-target-retirement',
    );
    return true;
  });
  assert.equal(clock.timerCount(), 0);
  assert.equal(observations.at(-1).cleanup.hostTimerCleared, true);
});

test('scene measurement preserves page failures and publishes bounded evidence', async () => {
  const clock = controlledClock();
  const pageError = new Error('page measurement failed');
  const observations = [];

  await assert.rejects(
    runSceneMeasurementWithHostDeadline({
      evaluate: async () => {
        throw pageError;
      },
      measurementMs: 100,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onProgress: (observation) => observations.push(observation),
    }),
    (error) => {
      assert.equal(error, pageError);
      assert.equal(error.sceneMeasurementObservation.status, 'page-error');
      assert.equal(
        error.sceneMeasurementObservation.pageError.message,
        'page measurement failed',
      );
      return true;
    },
  );
  assert.equal(clock.timerCount(), 0);
  assert.equal(observations.at(-1).status, 'page-error');
});

test('scene measurement records a late page settlement without reviving capture', async () => {
  const clock = controlledClock();
  const observations = [];
  let settlePage;
  const pending = runSceneMeasurementWithHostDeadline({
    evaluate: () =>
      new Promise((resolve) => {
        settlePage = resolve;
      }),
    measurementMs: 100,
    hostGraceMs: 25,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onProgress: (observation) => observations.push(observation),
  });
  await Promise.resolve();
  clock.advance(125);
  await assert.rejects(pending, { name: 'TimeoutError' });

  settlePage({ frameCount: 1 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(observations.at(-1).status, 'host-deadline');
  assert.equal(observations.at(-1).latePageSettlementObserved, true);
  assert.equal(
    observations.at(-1).cleanup.pageEvaluationRetirement,
    'settled-after-deadline',
  );
});
