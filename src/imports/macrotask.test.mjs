import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacrotaskScheduler } from './macrotask.js';

function fakeChannels() {
  const channels = [];
  class Port {
    listeners = new Set();
    closed = false;
    onmessage = null;
    addEventListener(name, listener) {
      if (name === 'message') this.listeners.add(listener);
    }
    removeEventListener(name, listener) {
      if (name === 'message') this.listeners.delete(listener);
    }
    start() {}
    postMessage() {
      channels.at(-1).queued = true;
    }
    close() {
      this.closed = true;
    }
    dispatch() {
      for (const listener of this.listeners) listener();
      this.onmessage?.();
    }
  }
  class Channel {
    constructor() {
      this.port1 = new Port();
      this.port2 = new Port();
      channels.push(this);
    }
  }
  return { Channel, channels };
}

test('MessageChannel macrotasks run once and release both owned ports', () => {
  const { Channel, channels } = fakeChannels();
  const scheduler = createMacrotaskScheduler({
    scheduler: null,
    MessageChannelCtor: Channel,
  });
  let calls = 0;
  const handle = scheduler.schedule(() => calls++);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].queued, true);
  channels[0].port1.dispatch();
  channels[0].port1.dispatch();
  assert.equal(calls, 1);
  assert.equal(channels[0].port1.closed, true);
  assert.equal(channels[0].port2.closed, true);
  assert.equal(channels[0].port1.listeners.size, 0);
  scheduler.cancel(handle);
  assert.equal(calls, 1);
});

test('cancelling a queued MessageChannel task detaches listener and ports', () => {
  const { Channel, channels } = fakeChannels();
  const scheduler = createMacrotaskScheduler({
    scheduler: null,
    MessageChannelCtor: Channel,
  });
  let calls = 0;
  const handle = scheduler.schedule(() => calls++);
  scheduler.cancel(handle);
  channels[0].port1.dispatch();
  assert.equal(calls, 0);
  assert.equal(channels[0].port1.listeners.size, 0);
  assert.equal(channels[0].port1.closed, true);
  assert.equal(channels[0].port2.closed, true);
});

test('a throwing MessageChannel callback still closes owned resources', () => {
  const { Channel, channels } = fakeChannels();
  const scheduler = createMacrotaskScheduler({
    scheduler: null,
    MessageChannelCtor: Channel,
  });
  scheduler.schedule(() => {
    throw new Error('callback failure');
  });
  assert.throws(() => channels[0].port1.dispatch(), /callback failure/);
  assert.equal(channels[0].port1.closed, true);
  assert.equal(channels[0].port2.closed, true);
  assert.equal(channels[0].port1.listeners.size, 0);
});

test('scheduler.postTask is preferred and abort cancels pending work', async () => {
  const tasks = [];
  const scheduler = createMacrotaskScheduler({
    scheduler: {
      postTask(callback, options) {
        const pending = new Promise((resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
          tasks.push({
            callback,
            options,
            run() {
              callback();
              resolve();
            },
          });
        });
        return pending;
      },
    },
    MessageChannelCtor: null,
  });
  let calls = 0;
  const handle = scheduler.schedule(() => calls++);
  assert.equal(handle.kind, 'postTask');
  assert.equal(tasks.length, 1);
  scheduler.cancel(handle);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
  assert.equal(tasks[0].options.signal.aborted, true);
});

test('timer fallback is used when postTask and MessageChannel are unavailable', () => {
  const timers = new Map();
  let nextId = 0;
  const scheduler = createMacrotaskScheduler({
    scheduler: null,
    MessageChannelCtor: null,
    setTimer(callback, delay) {
      assert.equal(delay, 0);
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
  });
  let calls = 0;
  const handle = scheduler.schedule(() => calls++);
  assert.equal(handle.kind, 'timer');
  scheduler.cancel(handle);
  assert.equal(timers.size, 0);
  assert.equal(calls, 0);
});
