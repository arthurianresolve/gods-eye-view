import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { startImportTraceSession } from './importTraceSession.mjs';

class FakeSession extends EventEmitter {
  calls = [];
  detachCalls = 0;
  start = async () => {};
  end = async () => {};
  detachBehavior = async () => {};

  send(method, params) {
    this.calls.push({ method, params });
    if (method === 'Tracing.start') return this.start(params);
    if (method === 'Tracing.end') return this.end(params);
    throw new Error(`Unexpected command: ${method}`);
  }

  detach() {
    this.detachCalls += 1;
    return this.detachBehavior();
  }

  activeListeners() {
    return (
      this.listenerCount('Tracing.dataCollected') +
      this.listenerCount('Tracing.bufferUsage') +
      this.listenerCount('Tracing.tracingComplete')
    );
  }
}

const options = { timeoutMs: 15, cleanupTimeoutMs: 15 };

test('starts, collects streamed events, stops and detaches once', async () => {
  const session = new FakeSession();
  session.end = async () => {
    queueMicrotask(() => session.emit('Tracing.tracingComplete', {}));
  };
  const trace = await startImportTraceSession(session, options);
  session.emit('Tracing.bufferUsage', { percentFull: 0.2 });
  session.emit('Tracing.dataCollected', {
    value: [
      {
        name: 'V8.GCScavenger',
        cat: 'disabled-by-default-v8.gc',
        ph: 'B',
        ts: 1_000,
        pid: 1,
        tid: 2,
      },
    ],
  });
  session.emit('Tracing.dataCollected', {
    value: [
      {
        name: 'V8.GCScavenger',
        cat: 'disabled-by-default-v8.gc',
        ph: 'E',
        ts: 2_000,
        pid: 1,
        tid: 2,
      },
    ],
  });
  const result = await trace.stop();
  assert.equal(result.stopError, null);
  assert.equal(result.bufferUsagePeak, 0.2);
  assert.deepEqual(result.events[0], {
    kind: 'gc',
    name: 'V8.GCScavenger',
    tsUs: 1_000,
    durationUs: 1_000,
    pid: 1,
    tid: 2,
  });
  assert.equal(session.activeListeners(), 0);
  assert.equal(session.detachCalls, 1);
  assert.deepEqual(
    session.calls.map((call) => call.method),
    ['Tracing.start', 'Tracing.end'],
  );
});

test('bounds a missing Tracing.end acknowledgement and releases ownership', async () => {
  const session = new FakeSession();
  session.end = () => new Promise(() => {});
  const trace = await startImportTraceSession(session, options);
  const result = await trace.stop();
  assert.match(result.stopError, /acknowledgement\/completion timed out/);
  assert.equal(session.activeListeners(), 0);
  assert.equal(session.detachCalls, 1);
});

test('bounds missing tracingComplete even when the end acknowledgement arrives', async () => {
  const session = new FakeSession();
  const trace = await startImportTraceSession(session, options);
  const result = await trace.stop();
  assert.match(result.stopError, /acknowledgement\/completion timed out/);
  assert.equal(session.activeListeners(), 0);
  assert.equal(session.detachCalls, 1);
});

test('bounds start acknowledgement and detaches after removing listeners', async () => {
  const session = new FakeSession();
  session.start = () => new Promise(() => {});
  await assert.rejects(
    startImportTraceSession(session, options),
    /Tracing.start acknowledgement timed out/,
  );
  assert.equal(session.activeListeners(), 0);
  assert.equal(session.detachCalls, 1);
});

test('bounds detach when Tracing.start fails and preserves cleanup error', async () => {
  const session = new FakeSession();
  session.start = async () => {
    throw new Error('start rejected');
  };
  session.detachBehavior = () => new Promise(() => {});
  const startedAt = Date.now();
  await assert.rejects(startImportTraceSession(session, options), (error) => {
    assert.match(error.message, /start rejected/);
    assert.match(error.traceCleanupError, /detach timed out/);
    return true;
  });
  assert.ok(Date.now() - startedAt < 250);
  assert.equal(session.activeListeners(), 0);
  assert.equal(session.detachCalls, 1);
});
