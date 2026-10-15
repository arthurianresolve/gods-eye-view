import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateForegroundPage,
  FOREGROUND_ACTIVATION_SCHEMA,
} from './foregroundPageActivation.mjs';

function fakePage({ waitError = null, states = [] } = {}) {
  const calls = [];
  let stateIndex = 0;
  return {
    calls,
    async bringToFront() {
      calls.push(['bringToFront']);
    },
    async waitForFunction(predicate, options) {
      calls.push(['waitForFunction', options]);
      assert.equal(typeof predicate, 'function');
      if (waitError) throw waitError;
    },
    async evaluate(observer) {
      calls.push(['evaluate']);
      assert.equal(typeof observer, 'function');
      const state = states[Math.min(stateIndex, states.length - 1)] ?? {
        visible: true,
        focused: true,
        visibilityState: 'visible',
      };
      stateIndex += 1;
      return state;
    },
  };
}

test('activates and verifies the measured page before warmup', async () => {
  const page = fakePage();
  const result = await activateForegroundPage(page, {
    timeoutMs: 3200,
    pollingMs: 25,
  });

  assert.deepEqual(page.calls, [
    ['bringToFront'],
    ['waitForFunction', { timeout: 3200, polling: 25 }],
    ['evaluate'],
  ]);
  assert.deepEqual(result, {
    schema: FOREGROUND_ACTIVATION_SCHEMA,
    visible: true,
    focused: true,
    visibilityState: 'visible',
    timeoutMs: 3200,
    pollingMs: 25,
  });
});

test('records terminal foreground state when activation times out', async () => {
  const page = fakePage({
    waitError: new Error('timeout'),
    states: [{ visible: true, focused: false, visibilityState: 'visible' }],
  });

  await assert.rejects(
    activateForegroundPage(page),
    (error) =>
      error.name === 'ForegroundActivationError' &&
      error.state?.visible === true &&
      error.state?.focused === false &&
      error.cause?.message === 'timeout',
  );
  assert.deepEqual(page.calls, [
    ['bringToFront'],
    ['waitForFunction', { timeout: 5000, polling: 50 }],
    ['evaluate'],
  ]);
});

test('rejects a page that loses focus immediately after activation', async () => {
  const page = fakePage({
    states: [{ visible: true, focused: false, visibilityState: 'visible' }],
  });

  await assert.rejects(
    activateForegroundPage(page),
    /lost foreground immediately after activation/,
  );
});
