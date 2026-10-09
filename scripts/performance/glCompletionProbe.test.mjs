import test from 'node:test';
import assert from 'node:assert/strict';
import { observeSubmittedCommands } from './glCompletionProbe.mjs';

function fixture() {
  let time = 0;
  let callback;
  let deleted = 0;
  let cancelled = 0;
  let status = 1;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 0,
    TIMEOUT_EXPIRED: 1,
    ALREADY_SIGNALED: 2,
    CONDITION_SATISFIED: 3,
    WAIT_FAILED: 4,
    fenceSync: () => ({}),
    flush() {},
    clientWaitSync(_sync, flags, timeout) {
      assert.equal(flags, 0);
      assert.equal(timeout, 0);
      return status;
    },
    deleteSync() {
      deleted++;
    },
  };
  const options = {
    now: () => time,
    schedule(fn) {
      callback = fn;
      return 10;
    },
    cancel(id) {
      assert.equal(id, 10);
      cancelled++;
    },
  };
  return {
    gl,
    options,
    tick(value, at = 8) {
      status = value;
      time = at;
      callback();
    },
    assertReleased() {
      assert.equal(deleted, 1);
      assert.equal(cancelled, 1);
    },
  };
}

test('unavailable WebGL metrics stay unavailable', () => {
  const result = observeSubmittedCommands(null).finish();
  assert.equal(result.state, 'unavailable');
  assert.equal(result.completionObservedAfterMs, null);
  assert.equal(result.polls, 0);
});

for (const state of [2, 3]) {
  test(`observed completion ${state} releases its fence and timer once`, () => {
    const f = fixture();
    const probe = observeSubmittedCommands(f.gl, f.options);
    f.tick(1);
    f.tick(state, 16);
    const result = probe.finish();
    assert.equal(result.state, 'completed');
    assert.equal(result.completionObservedAfterMs, 16);
    assert.equal(result.polls, 2);
    assert.deepEqual(probe.finish(), result);
    f.tick(1, 24);
    f.assertReleased();
  });
}

test('ending an observation releases an unsignaled fence without a pass', () => {
  const f = fixture();
  const probe = observeSubmittedCommands(f.gl, f.options);
  f.tick(1);
  const result = probe.finish();
  assert.equal(result.state, 'pending');
  assert.equal(result.completionObservedAfterMs, null);
  f.assertReleased();
});

test('wait failure and exceptions release ownership without a duration', () => {
  for (const throws of [false, true]) {
    const f = fixture();
    const probe = observeSubmittedCommands(f.gl, f.options);
    if (throws)
      f.gl.clientWaitSync = () => {
        throw new Error('lost');
      };
    f.tick(4);
    assert.equal(probe.finish().state, 'failed');
    assert.equal(probe.finish().completionObservedAfterMs, null);
    f.assertReleased();
  }
});

test('fence creation failure does not schedule a poll', () => {
  const f = fixture();
  f.gl.fenceSync = () => null;
  f.options.schedule = () => assert.fail('unexpected timer');
  assert.equal(
    observeSubmittedCommands(f.gl, f.options).finish().state,
    'failed',
  );
});
