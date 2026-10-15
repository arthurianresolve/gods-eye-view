import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUSTIN_POST_MEASUREMENT_SOURCE_DRAIN_MS,
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
    scope:
      'host wait after the timed sample and before completed-render/source-readiness validation',
  });
});

test('post-measurement drain rejects invalid bounds and early completion', async () => {
  await assert.rejects(
    waitForPostMeasurementSourceDrain({ minimumMs: 0 }),
    /between 1 and 2000 ms/,
  );
  let elapsedMs = 0;
  await assert.rejects(
    waitForPostMeasurementSourceDrain({
      minimumMs: 250,
      now: () => elapsedMs,
      wait: async () => {
        elapsedMs = 249;
      },
    }),
    /ended before its bound/,
  );
});
