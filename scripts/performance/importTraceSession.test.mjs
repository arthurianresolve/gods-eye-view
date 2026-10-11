import test from 'node:test';
import assert from 'node:assert/strict';
import { startImportTraceSession } from './importTraceSession.mjs';

class FakeSession {
  listeners = new Map();
  detached = false;
  completeEvent = { dataLossOccurred: false };
  emitComplete = true;

  on(name, listener) {
    const listeners = this.listeners.get(name) || new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  off(name, listener) {
    this.listeners.get(name)?.delete(listener);
  }

  emit(name, value) {
    for (const listener of this.listeners.get(name) || []) listener(value);
  }

  async send(method) {
    if (method === 'Tracing.end' && this.emitComplete) {
      queueMicrotask(() =>
        this.emit('Tracing.tracingComplete', this.completeEvent),
      );
    }
    return {};
  }

  async detach() {
    this.detached = true;
  }
}

test('completed short trace reports unavailable buffer sampling without inventing zero', async () => {
  const session = new FakeSession();
  const trace = await (await startImportTraceSession(session)).stop();
  assert.equal(trace.completionObserved, true);
  assert.equal(trace.dataLossOccurred, false);
  assert.equal(trace.bufferUsagePeak, null);
  assert.equal(trace.bufferUsageCount, 0);
  assert.equal(trace.bufferUsageStatus, 'unavailable');
  assert.equal(trace.stopError, null);
  assert.equal(session.detached, true);
});

test('periodic buffer observations are retained and peak is the observed maximum', async () => {
  const session = new FakeSession();
  const traceSession = await startImportTraceSession(session);
  session.emit('Tracing.bufferUsage', { percentFull: 0.3 });
  session.emit('Tracing.bufferUsage', { value: 0.72 });
  const trace = await traceSession.stop();
  assert.equal(trace.bufferUsageStatus, 'observed');
  assert.equal(trace.bufferUsageCount, 2);
  assert.equal(trace.bufferUsagePeak, 0.72);
});

test('tracingComplete data-loss and malformed required flag remain explicit failures', async () => {
  for (const event of [
    { dataLossOccurred: true },
    {},
    { dataLossOccurred: 'false' },
  ]) {
    const session = new FakeSession();
    session.completeEvent = event;
    const trace = await (await startImportTraceSession(session)).stop();
    assert.equal(trace.completionObserved, true);
    assert.equal(
      trace.dataLossOccurred,
      typeof event.dataLossOccurred === 'boolean'
        ? event.dataLossOccurred
        : null,
    );
    assert.equal(typeof trace.stopError, 'string');
  }
});

test('missing tracingComplete times out and still detaches the owned session', async () => {
  const session = new FakeSession();
  session.emitComplete = false;
  const traceSession = await startImportTraceSession(session, {
    timeoutMs: 5,
    cleanupTimeoutMs: 20,
  });
  const trace = await traceSession.stop();
  assert.equal(trace.completionObserved, false);
  assert.equal(trace.dataLossOccurred, null);
  assert.match(trace.stopError, /timed out/);
  assert.equal(session.detached, true);
});

test('malformed buffer samples fail explicitly instead of becoming unavailable', async () => {
  for (const event of [{ percentFull: 1.5 }, null, { value: '0.5' }]) {
    const session = new FakeSession();
    const traceSession = await startImportTraceSession(session);
    session.emit('Tracing.bufferUsage', event);
    const trace = await traceSession.stop();
    assert.equal(trace.bufferUsageCount, 0);
    assert.equal(trace.bufferUsagePeak, null);
    assert.equal(trace.bufferUsageStatus, 'unavailable');
    assert.equal(trace.stopError, 'trace-buffer-usage-malformed');
  }
});

test('optional buffer-usage payload with no numeric field remains unavailable', async () => {
  const session = new FakeSession();
  const traceSession = await startImportTraceSession(session);
  session.emit('Tracing.bufferUsage', { eventCount: 12 });
  const trace = await traceSession.stop();
  assert.equal(trace.bufferUsagePeak, null);
  assert.equal(trace.bufferUsageCount, 0);
  assert.equal(trace.bufferUsageStatus, 'unavailable');
  assert.equal(trace.stopError, null);
});
