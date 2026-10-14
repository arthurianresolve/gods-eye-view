import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineArbiter } from './timelineArbiter.js';

test('timeline ownership changes only after an explicit handoff', async () => {
  const arbiter = createTimelineArbiter();
  assert.equal(await arbiter.claim('director'), true);
  assert.equal(await arbiter.claim('investigation'), false);
  assert.equal(arbiter.getState().owner, 'director');
  assert.equal(
    await arbiter.claim('investigation', {
      onConflict: ({ from, to }) =>
        from === 'director' && to === 'investigation',
    }),
    true,
  );
  assert.equal(arbiter.getState().owner, 'investigation');
  assert.equal(arbiter.release('director'), false);
  assert.equal(arbiter.release('investigation'), true);
  assert.equal(arbiter.getState().owner, null);
  arbiter.destroy();
});

test('stale handoff callbacks cannot steal an owner after a newer transition', async () => {
  const arbiter = createTimelineArbiter();
  await arbiter.claim('director');
  let finish;
  const pending = arbiter.claim('investigation', {
    onConflict: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await Promise.resolve();
  assert.equal(arbiter.release('director'), true);
  await arbiter.claim('launch');
  finish(true);
  assert.equal(await pending, false);
  assert.equal(arbiter.getState().owner, 'launch');
  arbiter.destroy();
});

test('an approved handoff stops and releases the prior owner before publishing the new owner', async () => {
  const arbiter = createTimelineArbiter();
  const events = [];
  await arbiter.claim('director');
  arbiter.register('director', async ({ to }) => {
    events.push(`stop:${to}`);
    arbiter.release('director');
    return true;
  });
  arbiter.subscribe(({ owner }) => events.push(`owner:${owner || 'none'}`));

  assert.equal(
    await arbiter.claim('investigation', { onConflict: () => true }),
    true,
  );
  assert.deepEqual(events, [
    'owner:director',
    'stop:investigation',
    'owner:none',
    'owner:investigation',
  ]);
  arbiter.destroy();
});

test('a refusing owner stop keeps ownership and blocks the handoff', async () => {
  const arbiter = createTimelineArbiter();
  await arbiter.claim('launch-replay');
  arbiter.register('launch-replay', () => false);

  assert.equal(
    await arbiter.claim('director', { onConflict: () => true }),
    false,
  );
  assert.equal(arbiter.getState().owner, 'launch-replay');
  arbiter.destroy();
});
