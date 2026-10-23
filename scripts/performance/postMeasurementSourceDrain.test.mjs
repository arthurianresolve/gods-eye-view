import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUSTIN_POST_MEASUREMENT_SOURCE_DRAIN_MS,
  settlePostMeasurementSourceChanges,
  waitForPostMeasurementSourceDrain,
} from './postMeasurementSourceDrain.mjs';

test('post-measurement drain waits outside the timed sample for the declared bound', async () => {
  let elapsedMs = 1000;
  const calls = [];
  const result = await waitForPostMeasurementSourceDrain({
    now: () => elapsedMs,
    wait: async (delayMs) => {
      calls.push(delayMs);
      elapsedMs += delayMs;
    },
  });
  assert.deepEqual(calls, [AUSTIN_POST_MEASUREMENT_SOURCE_DRAIN_MS]);
  assert.deepEqual(result, {
    schema: 'gev-post-measurement-source-drain/v1',
    minimumMs: AUSTIN_POST_MEASUREMENT_SOURCE_DRAIN_MS,
    elapsedMs: AUSTIN_POST_MEASUREMENT_SOURCE_DRAIN_MS,
    waitAttempts: 1,
    scope:
      'host wait after the timed sample and before completed-render/source-readiness validation',
  });
});

test('post-measurement drain completes the remaining time after an early timer', async () => {
  await assert.rejects(
    waitForPostMeasurementSourceDrain({ minimumMs: 0 }),
    /between 1 and 2000 ms/,
  );
  let elapsedMs = 0;
  const waits = [];
  const result = await waitForPostMeasurementSourceDrain({
    minimumMs: 250,
    now: () => elapsedMs,
    wait: async (delayMs) => {
      waits.push(delayMs);
      elapsedMs += waits.length === 1 ? delayMs - 1 : delayMs;
    },
  });
  assert.deepEqual(waits, [250, 1]);
  assert.equal(result.elapsedMs, 250);
  assert.equal(result.waitAttempts, 2);
});

test('post-measurement drain remains bounded when time does not advance', async () => {
  let waitCalls = 0;
  await assert.rejects(
    waitForPostMeasurementSourceDrain({
      minimumMs: 250,
      now: () => 0,
      wait: async () => {
        waitCalls += 1;
      },
    }),
    /after 4 waits \(0 ms\)/,
  );
  assert.equal(waitCalls, 4);
});

test('source settling renders the final camera pose before draining debounce work', async () => {
  const order = [];
  const result = await settlePostMeasurementSourceChanges({
    settleSourceTriggerBoundary: async () => {
      order.push('render');
      return { status: 'settled' };
    },
    settleSourceReadinessBoundary: async () => {
      order.push('readiness');
      return { status: 'ready' };
    },
    waitForDrain: async (phase) => {
      order.push(`drain:${phase}`);
      return { elapsedMs: 250 };
    },
  });
  assert.deepEqual(order, [
    'render',
    'drain:trigger-render',
    'readiness',
    'drain:readiness-render',
  ]);
  assert.deepEqual(result, {
    schema: 'gev-post-measurement-source-settle/v1',
    sourceTriggerBoundary: { status: 'settled' },
    triggerDrain: { elapsedMs: 250 },
    sourceReadinessBoundary: { status: 'ready' },
    readinessDrain: { elapsedMs: 250 },
  });
});

test('source settling does not drain when the trigger render fails', async () => {
  let drained = false;
  await assert.rejects(
    settlePostMeasurementSourceChanges({
      settleSourceTriggerBoundary: async () => {
        throw new Error('trigger render failed');
      },
      settleSourceReadinessBoundary: async () => {},
      waitForDrain: async () => {
        drained = true;
      },
    }),
    /trigger render failed/,
  );
  assert.equal(drained, false);
});

test('source settling stops before the final drain when readiness fails', async () => {
  let drainCount = 0;
  await assert.rejects(
    settlePostMeasurementSourceChanges({
      settleSourceTriggerBoundary: async () => ({ status: 'settled' }),
      settleSourceReadinessBoundary: async () => {
        throw new Error('readiness failed');
      },
      waitForDrain: async () => {
        drainCount += 1;
      },
    }),
    /readiness failed/,
  );
  assert.equal(drainCount, 1);
});
