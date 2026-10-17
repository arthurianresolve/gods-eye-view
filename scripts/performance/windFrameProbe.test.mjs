import assert from 'node:assert/strict';
import test from 'node:test';
import { runWindFrameProbe } from './windFrameProbe.mjs';

test('no-copy mode makes three bounded requests with fixed spacing and no pixel work', async () => {
  let now = 0;
  let frames = 0;
  const waits = [];
  const result = await runWindFrameProbe({
    captureMode: 'no-copy',
    now: () => now,
    wait: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    waitForFrame: async ({ timeoutMs }) => {
      assert.equal(timeoutMs, 400);
      now += 7;
      frames++;
      return true;
    },
    snapshot: () => ({ frames }),
    readPixels() {
      assert.fail('No-copy mode must not read pixels.');
    },
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.completedAttempts, 3);
  assert.deepEqual(waits, [20, 20]);
  assert.deepEqual(
    result.attempts.map((item) => item.actualSpacingBeforeMs),
    [null, 20, 20],
  );
  assert.deepEqual(
    result.attempts.map((item) => item.frameWaitMs),
    [7, 7, 7],
  );
  assert.deepEqual(
    result.attempts.map((item) => item.after.frames),
    [1, 2, 3],
  );
  assert.equal(result.attempts[0].getImageDataMs, null);
  assert.equal(result.attempts[0].hashMs, null);
});

test('copy mode times frame copy, pixel extraction and hashing, and releases each canvas', async () => {
  let now = 0;
  let released = 0;
  const result = await runWindFrameProbe({
    captureMode: 'copy',
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    waitForFrame: async () => {
      now += 4;
      return { width: 2, height: 2 };
    },
    readPixels: async () => {
      now += 3;
      return new Uint8Array([1, 2]);
    },
    hashPixels: async () => {
      now += 2;
      return 'a'.repeat(64);
    },
    releaseFrame: () => released++,
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.attempts[0].frameWaitAndCopyMs, 4);
  assert.equal(result.attempts[0].getImageDataMs, 3);
  assert.equal(result.attempts[0].hashMs, 2);
  assert.equal(released, 3);
});

test('a missing frame stops at the first failure without retrying', async () => {
  let calls = 0;
  const result = await runWindFrameProbe({
    captureMode: 'no-copy',
    wait: async () => {},
    waitForFrame: async () => {
      calls++;
      return false;
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.completedAttempts, 0);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].failurePhase, 'frame-wait');
  assert.equal(calls, 1);
});

test('a pixel extraction error is retained and its copied frame is released', async () => {
  let released = 0;
  let calls = 0;
  const result = await runWindFrameProbe({
    captureMode: 'copy',
    wait: async () => {},
    waitForFrame: async () => ({ width: 1, height: 1 }),
    readPixels: () => {
      throw new Error('bounded extraction failure');
    },
    hashPixels: async () => 'b'.repeat(64),
    releaseFrame: () => released++,
    snapshot: () => ({ calls: calls++ }),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].failurePhase, 'getImageData');
  assert.equal(result.attempts[0].error, 'bounded extraction failure');
  assert.equal(released, 1);
});

test('a frame cleanup error fails and stops the control', async () => {
  let waits = 0;
  let calls = 0;
  const result = await runWindFrameProbe({
    captureMode: 'copy',
    wait: async () => {
      waits++;
    },
    waitForFrame: async () => ({ width: 1, height: 1 }),
    readPixels: async () => new Uint8Array([0]),
    hashPixels: async () => 'c'.repeat(64),
    releaseFrame: () => {
      throw new Error('cleanup failed');
    },
    snapshot: () => {
      calls++;
      return null;
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.completedAttempts, 0);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].failurePhase, 'releaseFrame');
  assert.equal(result.attempts[0].error, 'cleanup failed');
  assert.equal(waits, 0);
  assert.equal(calls, 2);
});
