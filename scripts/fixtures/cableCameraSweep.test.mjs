import assert from 'node:assert/strict';
import test from 'node:test';
import { createCableCameraSweepGate } from './cableCameraSweep.mjs';

function event() {
  const listeners = new Set();
  return {
    listeners,
    addEventListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    raise() {
      for (const listener of [...listeners]) listener();
    },
  };
}

function gateState() {
  const moveEnd = event();
  const postRender = event();
  const scene = {
    postRender,
    frameState: { frameNumber: 0 },
    renderRequests: 0,
    requestRender() {
      this.renderRequests += 1;
    },
  };
  const camera = { moveEnd };
  return { camera, moveEnd, postRender, scene };
}

test('camera gate waits for flight completion, final moveEnd, and sweep frame', async () => {
  const state = gateState();
  let pose = { value: 'intermediate' };
  const expectedPose = { value: 'final' };
  const gate = createCableCameraSweepGate(state.camera, state.scene, {
    timeoutMs: 100,
    readPose: () => pose,
    samePose: (actual, expected) => actual.value === expected.value,
  });
  let settled = false;
  gate.promise.then(() => {
    settled = true;
  });

  for (let frame = 1; frame <= 4; frame += 1) {
    state.scene.frameState.frameNumber = frame;
    state.postRender.raise();
  }
  await Promise.resolve();
  assert.equal(
    settled,
    false,
    'stable frames before camera movement are insufficient',
  );
  assert.equal(state.moveEnd.listeners.size, 1);

  // A moveEnd during a frame gap records the intermediate pose. Even if the
  // camera later reaches the flight destination, that stale event is rejected.
  state.moveEnd.raise();
  pose = expectedPose;
  gate.markFlightComplete(expectedPose);
  state.scene.frameState.frameNumber = 5;
  state.postRender.raise();
  await Promise.resolve();
  assert.equal(
    settled,
    false,
    'a moveEnd recorded at an intermediate pose must not satisfy the gate',
  );

  // A new moveEnd at the completed flight pose and its postRender are required.
  state.moveEnd.raise();
  state.scene.frameState.frameNumber = 6;
  state.postRender.raise();
  assert.deepEqual(await gate.promise, {
    status: 'swept',
    frameNumber: 6,
    finalPoseVerified: true,
    flightCompleteVerified: true,
  });
  assert.equal(state.moveEnd.listeners.size, 0);
  assert.equal(state.postRender.listeners.size, 0);
  assert.ok(state.scene.renderRequests >= 1);
});

test('a sweep rejection is observed while the flight promise is still pending', async () => {
  const state = gateState();
  let readPoseError = false;
  const gate = createCableCameraSweepGate(state.camera, state.scene, {
    timeoutMs: 100,
    readPose() {
      if (readPoseError) throw new Error('pose read failed');
      return { value: 'final' };
    },
    samePose: (actual, expected) => actual.value === expected.value,
  });
  // Attach the rejection handler before waiting on the independent flight.
  const sweepOutcome = gate.promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  let releaseFlight;
  const flight = new Promise((resolve) => {
    releaseFlight = resolve;
  });

  gate.markFlightComplete({ value: 'final' });
  state.moveEnd.raise();
  readPoseError = true;
  state.postRender.raise();
  releaseFlight();
  await flight;

  const outcome = await sweepOutcome;
  assert.match(outcome.error?.message || '', /pose read failed/);
  assert.equal(state.moveEnd.listeners.size, 0);
  assert.equal(state.postRender.listeners.size, 0);
});

test('camera gate cancellation removes listeners and timeout', async () => {
  const state = gateState();
  const gate = createCableCameraSweepGate(state.camera, state.scene, {
    timeoutMs: 100,
    readPose: () => ({}),
    samePose: () => false,
  });
  gate.cancel();
  assert.deepEqual(await gate.promise, {
    status: 'cancelled',
    frameNumber: null,
    finalPoseVerified: false,
    flightCompleteVerified: false,
  });
  assert.equal(state.moveEnd.listeners.size, 0);
  assert.equal(state.postRender.listeners.size, 0);
});

test('camera gate timeout rejects and releases its moveEnd listener', async () => {
  const state = gateState();
  const gate = createCableCameraSweepGate(state.camera, state.scene, {
    timeoutMs: 5,
    readPose: () => ({}),
    samePose: () => false,
  });
  await assert.rejects(
    gate.promise,
    /final-pose sweep did not complete in time/,
  );
  assert.equal(state.moveEnd.listeners.size, 0);
  assert.equal(state.postRender.listeners.size, 0);
});
