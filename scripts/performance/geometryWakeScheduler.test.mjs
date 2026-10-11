import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageChannelWakeScheduler } from './geometryWakeScheduler.mjs';

function fakeMessageChannel() {
  const ports = [];
  const messages = [];
  class Port {
    peer = null;
    listeners = new Set();
    onmessage = null;
    closed = false;
    started = false;
    addEventListener(_type, listener) {
      this.listeners.add(listener);
    }
    removeEventListener(_type, listener) {
      this.listeners.delete(listener);
    }
    start() {
      this.started = true;
    }
    postMessage() {
      const peer = this.peer;
      messages.push(() => {
        if (peer.closed) return;
        for (const listener of peer.listeners) listener();
        peer.onmessage?.();
      });
    }
    close() {
      this.closed = true;
    }
  }
  return {
    ports,
    Constructor: class {
      constructor() {
        this.port1 = new Port();
        this.port2 = new Port();
        this.port1.peer = this.port2;
        this.port2.peer = this.port1;
        ports.push(this.port1, this.port2);
      }
    },
    flush() {
      for (const deliver of messages.splice(0)) deliver();
    },
  };
}

test('MessageChannel scheduler invokes once and closes ports before callback', () => {
  const fake = fakeMessageChannel();
  const scheduler = createMessageChannelWakeScheduler({
    MessageChannelCtor: fake.Constructor,
  });
  let calls = 0;
  scheduler.schedule(() => {
    calls++;
    assert.deepEqual(
      fake.ports.map((port) => port.closed),
      [true, true],
    );
    assert.equal(scheduler.pendingCount, 0);
  });
  assert.equal(scheduler.pendingCount, 1);
  fake.flush();
  assert.equal(calls, 1);
  assert.equal(scheduler.pendingCount, 0);
  assert.equal(fake.ports[0].listeners.size, 0);
});

test('MessageChannel scheduler cancellation and disposal release queued ports', () => {
  const fake = fakeMessageChannel();
  const scheduler = createMessageChannelWakeScheduler({
    MessageChannelCtor: fake.Constructor,
  });
  let calls = 0;
  const cancelled = scheduler.schedule(() => calls++);
  scheduler.cancel(cancelled);
  fake.flush();
  assert.equal(calls, 0);
  assert.equal(scheduler.pendingCount, 0);

  scheduler.schedule(() => calls++);
  scheduler.dispose();
  fake.flush();
  assert.equal(scheduler.pendingCount, 0);
  assert.ok(fake.ports.every((port) => port.closed));
  assert.throws(() => scheduler.schedule(() => {}), /disposed/);
});

test('MessageChannel construction failure is explicit and leaves no pending task', () => {
  const scheduler = createMessageChannelWakeScheduler({
    MessageChannelCtor: class {
      constructor() {
        throw new Error('channel unavailable');
      }
    },
  });
  assert.throws(() => scheduler.schedule(() => {}), /channel unavailable/);
  assert.equal(scheduler.pendingCount, 0);
});
