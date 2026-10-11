import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeInBatches } from './cooperative.js';
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

function fakePostTask() {
  const tasks = [];
  return {
    tasks,
    scheduler: {
      postTask(callback, { signal }) {
        return new Promise((resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
          tasks.push({
            callback,
            signal,
            run() {
              try {
                callback();
                resolve();
              } catch (error) {
                reject(error);
                throw error;
              }
            },
            reject,
          });
        });
      },
    },
  };
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

test('scheduler.postTask runs successfully once and is preferred', async () => {
  const { scheduler: postTask, tasks } = fakePostTask();
  const scheduler = createMacrotaskScheduler({
    scheduler: postTask,
    MessageChannelCtor: null,
  });
  let calls = 0;
  const handle = scheduler.schedule(() => calls++);
  assert.equal(handle.kind, 'postTask');
  assert.equal(scheduler.lastBackend, 'scheduler.postTask');
  assert.equal(tasks.length, 1);
  tasks[0].run();
  tasks[0].run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  scheduler.cancel(handle);
});

test('cancelling scheduler.postTask aborts pending work', async () => {
  const { scheduler: postTask, tasks } = fakePostTask();
  const scheduler = createMacrotaskScheduler({
    scheduler: postTask,
    MessageChannelCtor: null,
  });
  let calls = 0;
  const handle = scheduler.schedule(() => calls++);
  scheduler.cancel(handle);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].signal.aborted, true);
});

test('synchronous scheduler.postTask failure falls back to MessageChannel', () => {
  const { Channel, channels } = fakeChannels();
  const scheduler = createMacrotaskScheduler({
    scheduler: {
      postTask() {
        throw new Error('scheduler unavailable');
      },
    },
    MessageChannelCtor: Channel,
  });
  let calls = 0;
  scheduler.schedule(() => calls++);
  assert.equal(scheduler.lastBackend, 'MessageChannel');
  channels[0].port1.dispatch();
  assert.equal(calls, 1);
});

test('asynchronous postTask rejection falls back once and can be cancelled', async () => {
  const { scheduler: postTask, tasks } = fakePostTask();
  const { Channel, channels } = fakeChannels();
  const scheduler = createMacrotaskScheduler({
    scheduler: postTask,
    MessageChannelCtor: Channel,
  });
  let calls = 0;
  const handle = scheduler.schedule(() => calls++);
  tasks[0].reject(new Error('rejected before invocation'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.lastBackend, 'MessageChannel');
  assert.equal(channels.length, 1);
  scheduler.cancel(handle);
  channels[0].port1.dispatch();
  assert.equal(calls, 0);
  assert.equal(channels[0].port1.closed, true);
  assert.equal(channels[0].port2.closed, true);
});

test('postTask callback rejection does not schedule a duplicate callback', async () => {
  const { scheduler: postTask, tasks } = fakePostTask();
  const { Channel, channels } = fakeChannels();
  const scheduler = createMacrotaskScheduler({
    scheduler: postTask,
    MessageChannelCtor: Channel,
  });
  let calls = 0;
  scheduler.schedule(() => {
    calls++;
    throw new Error('callback failed');
  });
  assert.throws(() => tasks[0].run(), /callback failed/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(channels.length, 0);
});

test('async fallback failure rejects its owned consumer instead of hanging', async () => {
  const { scheduler: postTask, tasks } = fakePostTask();
  const scheduler = createMacrotaskScheduler({
    scheduler: postTask,
    MessageChannelCtor: class {
      constructor() {
        throw new Error('channel unavailable');
      }
    },
    setTimer() {
      throw new Error('timer unavailable');
    },
  });
  let iteratorClosed = false;
  function* work() {
    try {
      yield;
    } finally {
      iteratorClosed = true;
    }
  }
  const pending = consumeInBatches(work(), {
    budgetMs: 0,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  tasks[0].reject(new Error('rejected before invocation'));
  await assert.rejects(pending, /timer unavailable/);
  assert.equal(iteratorClosed, true);
});

test('timer fallback uses an owned cancellable macrotask', () => {
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
  const second = scheduler.schedule(() => calls++);
  const callback = timers.get(second.id);
  callback();
  callback();
  assert.equal(calls, 1);
  assert.equal(second.active, false);
});
