import test from 'node:test';
import assert from 'node:assert/strict';
import { driveNativePointerFixture } from './nativePointerFixture.mjs';

function setup(overrides = {}) {
  let elapsed = 0;
  let polls = 0;
  const events = [];
  const actions = [];
  const instruction = {
    id: 'pair-0-control',
    kind: 'drag',
    from: { x: 20, y: 30 },
    to: { x: 50, y: 60 },
    steps: 8,
  };
  const options = {
    readResult: async () => (++polls > 3 ? { status: 'passed' } : null),
    readInstruction: async () => instruction,
    mouse: {
      move: async (...args) => events.push(['move', ...args]),
      down: async () => events.push(['down']),
      up: async () => events.push(['up']),
    },
    viewport: { width: 1200, height: 960 },
    actions,
    now: () => elapsed,
    delay: async (ms) => {
      elapsed += ms;
    },
    timeoutMs: 1000,
    ...overrides,
  };
  return { options, events, actions, instruction };
}

test('dispatches native input once while waiting for actual fixture completion', async () => {
  const { options, events, actions } = setup();
  assert.deepEqual(await driveNativePointerFixture(options), {
    status: 'passed',
  });
  assert.deepEqual(events, [
    ['move', 20, 30],
    ['down'],
    ['move', 50, 60, { steps: 8 }],
    ['up'],
  ]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].status, 'dispatched');
});

test('rejects malformed or out-of-viewport instructions before input', async () => {
  for (const patch of [
    { kind: 'evaluate' },
    { id: '' },
    { from: { x: NaN, y: 1 } },
    { to: { x: 1200, y: 1 } },
    { steps: 0 },
    { steps: 100 },
  ]) {
    const { options, events, instruction } = setup();
    Object.assign(instruction, patch);
    await assert.rejects(driveNativePointerFixture(options), /Invalid native/);
    assert.equal(events.length, 0);
  }
});

test('button release and partial evidence survive a failed native move', async () => {
  const { options, actions, events } = setup();
  options.mouse.move = async (...args) => {
    events.push(['move', ...args]);
    if (args.length === 3) throw new Error('dispatch interrupted');
  };
  await assert.rejects(
    driveNativePointerFixture(options),
    /dispatch interrupted/,
  );
  assert.deepEqual(events.at(-1), ['up']);
  assert.equal(actions[0].status, 'failed');
  assert.equal(actions[0].finishedElapsedMs, 0);
});

test('dispatch alone cannot pass a fixture that never completes', async () => {
  const { options, actions } = setup({ readResult: async () => null });
  await assert.rejects(driveNativePointerFixture(options), /timed out/);
  assert.equal(actions.length, 1);
});

test('ambiguous button-down failure still attempts release', async () => {
  const { options, events, actions } = setup();
  options.mouse.down = async () => {
    throw new Error('button dispatch disconnected');
  };
  await assert.rejects(driveNativePointerFixture(options), /disconnected/);
  assert.deepEqual(events.at(-1), ['up']);
  assert.equal(actions[0].status, 'failed');
});

test('preserves a terminal fixture failure without dispatching stale input', async () => {
  const failure = { status: 'failed', error: 'calibration did not commit' };
  const { options, events } = setup({ readResult: async () => failure });
  assert.equal(await driveNativePointerFixture(options), failure);
  assert.equal(events.length, 0);
});
