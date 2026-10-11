import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CaptureStageTimeoutError,
  createCaptureStageJournal,
} from './captureStageJournal.mjs';

function fakeTimer() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    callbacks,
    schedule(callback, delay) {
      const id = ++nextId;
      callbacks.set(id, { callback, delay });
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    fire(id) {
      const timer = callbacks.get(id);
      assert.ok(timer, `Expected timer ${id} to remain pending.`);
      callbacks.delete(id);
      timer.callback();
    },
  };
}

test('stage journal records bounded timings without retaining operation results', async () => {
  let clock = 10;
  const published = [];
  const journal = createCaptureStageJournal({
    now: () => clock,
    onUpdate: (snapshot) => published.push(snapshot),
  });

  const result = await journal.run('warmup-render-settle', async () => {
    clock += 125;
    return { payload: 'not retained' };
  });

  assert.deepEqual(result, { payload: 'not retained' });
  assert.deepEqual(journal.snapshot(), [
    {
      sequence: 1,
      stage: 'warmup-render-settle',
      status: 'completed',
      startedAtMs: 10,
      elapsedMs: 125,
      timeoutMs: null,
      errorName: null,
    },
  ]);
  assert.equal(published.length, 2);
  assert.equal(JSON.stringify(journal.snapshot()).includes('payload'), false);
});

test('running stage snapshots report elapsed time without changing its status', async () => {
  let clock = 20;
  let finishOperation;
  const journal = createCaptureStageJournal({ now: () => clock });
  const pending = journal.run(
    'provider-population-readiness',
    () => new Promise((resolve) => (finishOperation = resolve)),
  );
  await Promise.resolve();
  clock = 57;

  assert.deepEqual(journal.snapshot(), [
    {
      sequence: 1,
      stage: 'provider-population-readiness',
      status: 'running',
      startedAtMs: 20,
      elapsedMs: 37,
      timeoutMs: null,
      errorName: null,
    },
  ]);
  finishOperation();
  await pending;
  assert.equal(journal.snapshot()[0].status, 'completed');
  assert.equal(journal.snapshot()[0].elapsedMs, 37);
});

test('stage journal attributes an operation failure and retains no error payload', async () => {
  let clock = 0;
  const journal = createCaptureStageJournal({ now: () => clock });
  const failure = Object.assign(new Error('private payload'), {
    name: 'ProtocolError',
  });

  await assert.rejects(
    journal.run('worker-blob-validation', async () => {
      clock = 4;
      throw failure;
    }),
    failure,
  );
  assert.deepEqual(journal.snapshot(), [
    {
      sequence: 1,
      stage: 'worker-blob-validation',
      status: 'failed',
      startedAtMs: 0,
      elapsedMs: 4,
      timeoutMs: null,
      errorName: 'ProtocolError',
    },
  ]);
  assert.equal(
    JSON.stringify(journal.snapshot()).includes('private payload'),
    false,
  );
});

test('stage timeout is bounded, clears its timer, and late completion never becomes success', async () => {
  const timer = fakeTimer();
  let clock = 2;
  let resolveOperation;
  const journal = createCaptureStageJournal({
    now: () => clock,
    scheduleTimeout: timer.schedule,
    cancelTimeout: timer.cancel,
  });
  const pending = journal.run(
    'worker-blob-read-and-restore',
    () =>
      new Promise((resolve) => {
        resolveOperation = resolve;
      }),
    { timeoutMs: 90_000 },
  );
  await Promise.resolve();
  assert.equal(timer.callbacks.size, 1);
  assert.equal([...timer.callbacks.values()][0].delay, 90_000);
  clock = 90_002;
  timer.fire([...timer.callbacks.keys()][0]);
  await assert.rejects(pending, CaptureStageTimeoutError);
  assert.equal(timer.callbacks.size, 0);
  assert.deepEqual(journal.snapshot()[0], {
    sequence: 1,
    stage: 'worker-blob-read-and-restore',
    status: 'timed-out',
    startedAtMs: 2,
    elapsedMs: 90_000,
    timeoutMs: 90_000,
    errorName: 'CaptureStageTimeoutError',
  });

  resolveOperation('late success');
  await Promise.resolve();
  assert.equal(journal.snapshot()[0].status, 'timed-out');
});

test('stage journal trims old records to its configured bound', async () => {
  let clock = 0;
  const journal = createCaptureStageJournal({
    now: () => clock++,
    maxRecords: 2,
  });
  await journal.run('provider-document-setup', async () => {});
  await journal.run('warmup', async () => {});
  await journal.run('completed-render-settle', async () => {});
  assert.deepEqual(
    journal.snapshot().map(({ stage }) => stage),
    ['warmup', 'completed-render-settle'],
  );
});

test('stage checkpoint selects only bounded records added after that stage', async () => {
  const journal = createCaptureStageJournal({
    now: () => 1,
    maxRecords: 2,
  });
  await journal.run('old-stage', async () => {});
  const checkpoint = journal.checkpoint();
  await journal.run('fresh-provider-document-setup', async () => {});
  await journal.run('warmup-render-settle', async () => {});
  assert.deepEqual(
    journal.since(checkpoint).map(({ stage }) => stage),
    ['fresh-provider-document-setup', 'warmup-render-settle'],
  );
  assert.throws(() => journal.since(-1), TypeError);
});
