import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  installInteractionEventTimingInPage,
  INTERACTION_EVENT_TIMING_PLAN,
  validateInteractionEventTiming,
} from './interactionEventTiming.mjs';

function fixture() {
  const samples = Array.from({ length: 20 }, (_, index) => {
    const clickAtMs = 1000 + index * 3000;
    return {
      generation: index + 1,
      armedAtMs: clickAtMs - 3,
      pointerDownAtMs: clickAtMs - 2,
      clickAtMs,
      clickReceivedAtMs: clickAtMs + 1,
      expectedLayerEnabled: index % 2 === 0,
      acceptedIntentAtMs: clickAtMs + 2,
      acceptedIntentEpoch: index + 1,
      buttonFeedbackFirstFrameAtMs: clickAtMs + 20,
      buttonFeedbackFirstRafTimestampMs: clickAtMs + 16,
      buttonFeedbackFirstState: 'transition',
      buttonFeedbackAtMs: clickAtMs + 40,
      renderedFrameAtMs: clickAtMs + 200,
    };
  });
  const capture = {
    ...INTERACTION_EVENT_TIMING_PLAN,
    status: 'observed',
    installedAtMs: 1,
    overflow: false,
    actions: samples.map((sample) => ({
      generation: sample.generation,
      clickAtMs: sample.clickAtMs,
      expected: sample.expectedLayerEnabled,
      targetMatched: true,
      trusted: true,
      visible: true,
      focused: true,
      witness: {
        atMs: sample.clickAtMs + 20,
        rafTimestampMs: sample.clickAtMs + 16,
        intentEpoch: sample.acceptedIntentEpoch,
        expected: sample.expectedLayerEnabled,
        state: 'transition',
        generation: sample.generation,
        visible: true,
        focused: true,
      },
      drainStartedAtMs: sample.clickAtMs + 200,
      drainEndedAtMs: sample.clickAtMs + 1200,
    })),
    entries: samples.map((sample) => ({
      name: 'click',
      entryType: 'event',
      startTime: sample.clickAtMs,
      duration: 64,
      processingStart: sample.clickAtMs + 0.5,
      processingEnd: sample.clickAtMs + 3,
      interactionId: sample.generation * 7,
      deliveredAtMs: sample.clickAtMs + 80,
      targetMatched: true,
      generation: sample.generation,
    })),
    observations: [],
  };
  return { samples, capture };
}

test('Event Timing requires exact complete native matches and preserves unavailable evidence', () => {
  const { samples, capture } = fixture();
  assert.deepEqual(
    validateInteractionEventTiming(capture, samples),
    Array(20).fill(64),
  );
  for (const corrupt of [
    (value) => {
      value.status = 'unavailable';
    },
    (value) => {
      value.entries.pop();
    },
    (value) => {
      value.entries.push({ ...value.entries[0] });
    },
    (value) => {
      value.entries[0].targetMatched = false;
    },
    (value) => {
      value.entries[0].generation++;
    },
    (value) => {
      value.entries[0].startTime += 0.01;
    },
    (value) => {
      value.entries[0].duration = 0;
    },
    (value) => {
      value.entries[0].duration = Infinity;
    },
    (value) => {
      value.entries[0].duration = 65;
    },
    (value) => {
      value.entries[0].interactionId = 0;
    },
    (value) => {
      value.entries[1].interactionId = value.entries[0].interactionId;
    },
    (value) => {
      value.entries[0].processingEnd = value.entries[0].startTime + 69;
    },
    (value) => {
      value.entries[0].deliveredAtMs = value.actions[0].drainEndedAtMs + 1;
    },
    (value) => {
      value.actions[0].drainEndedAtMs--;
    },
    (value) => {
      value.actions[0].witness.rafTimestampMs =
        value.actions[0].witness.atMs + 1;
    },
    (value) => {
      value.actions[0].expected = false;
    },
    (value) => {
      value.overflow = true;
    },
  ]) {
    const changed = structuredClone(capture);
    corrupt(changed);
    assert.throws(() => validateInteractionEventTiming(changed, samples));
  }
});

test('first visible same-intent state must precede earliest rendering endpoint; overlap is rejected', () => {
  const { samples, capture } = fixture();
  capture.actions[0].witness.atMs = samples[0].clickAtMs + 60;
  samples[0].buttonFeedbackFirstFrameAtMs = capture.actions[0].witness.atMs;
  validateInteractionEventTiming(capture, samples);
  capture.actions[0].witness.atMs++;
  samples[0].buttonFeedbackFirstFrameAtMs++;
  assert.throws(
    () => validateInteractionEventTiming(capture, samples),
    /earliest/,
  );
  capture.actions[0].witness.atMs--;
  samples[0].buttonFeedbackFirstFrameAtMs--;
  capture.actions[0].witness.intentEpoch++;
  assert.throws(() => validateInteractionEventTiming(capture, samples));
  const overlap = fixture();
  overlap.capture.entries[0].duration = 1200;
  overlap.capture.entries[0].deliveredAtMs = 2200;
  overlap.capture.actions[0].drainStartedAtMs = 1200;
  overlap.capture.actions[0].drainEndedAtMs = 2200;
  overlap.samples[1].pointerDownAtMs = 2205;
  assert.throws(
    () => validateInteractionEventTiming(overlap.capture, overlap.samples),
    /overlaps/,
  );
});

test('foreground loss and contrary intent through rendering invalidate; native control focus is allowed', () => {
  const { samples, capture } = fixture();
  capture.observations.push({
    atMs: 1025,
    kind: 'foreground',
    eventType: 'focus',
    targetKind: 'intended-control',
    trusted: true,
    visible: true,
    focused: true,
    invalid: false,
  });
  validateInteractionEventTiming(capture, samples);
  for (const observation of [
    {
      atMs: 1010,
      kind: 'foreground',
      visible: false,
      focused: true,
      invalid: true,
    },
    {
      atMs: 1025,
      kind: 'foreground',
      visible: true,
      focused: false,
      invalid: true,
    },
    { atMs: 1068, kind: 'contrary-intent', invalid: true },
    { atMs: 1030, kind: 'contrary-button-state', invalid: true },
  ]) {
    const changed = structuredClone(capture);
    changed.observations.push(observation);
    assert.throws(() => validateInteractionEventTiming(changed, samples));
  }
  capture.observations.push({
    atMs: 1069,
    kind: 'contrary-intent',
    invalid: true,
  });
  validateInteractionEventTiming(capture, samples);
});

function browserFixture({ throwAt = null } = {}) {
  let now = 1;
  let observerCallback;
  let pendingEntries = [];
  let disconnected = 0;
  let mutationDisconnected = 0;
  let intentUnsubscribed = 0;
  let mutationCallback;
  const mutationTargets = [];
  const timers = new Map();
  const listeners = new Map();
  const makeEvents = (name, target) => ({
    addEventListener(type, callback) {
      listeners.set(`${name}:${type}`, { callback, target });
    },
    removeEventListener(type) {
      listeners.delete(`${name}:${type}`);
    },
  });
  const layer = { visibilityIntentEpoch: 1, visibilityIntentEnabled: true };
  const ancestor = {
    parentElement: null,
    style: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      overflowX: 'visible',
      overflowY: 'visible',
    },
    rect: { left: 0, top: 0, right: 100, bottom: 100 },
    getBoundingClientRect() {
      return this.rect;
    },
  };
  const button = {
    parentElement: ancestor,
    isConnected: true,
    checkVisibility: () => true,
    disabled: false,
    textContent: 'ENABLING',
    dataset: { feedState: 'enabling' },
    classList: {
      contains: (name) => ['transitioning', 'enabling'].includes(name),
    },
    getAttribute: () => 'true',
    contains: () => false,
    getBoundingClientRect: () => ({
      width: 50,
      height: 20,
      left: 5,
      top: 5,
      right: 55,
      bottom: 25,
    }),
  };
  const document = {
    visibilityState: 'visible',
    hasFocus: () => true,
    querySelector: () => button,
  };
  Object.assign(document, makeEvents('document', document));
  const window = {
    innerWidth: 1440,
    innerHeight: 1000,
    getComputedStyle: (node) =>
      node.style || { display: 'block', visibility: 'visible', opacity: '1' },
    __godsEyeView: {
      dataManager: {
        layers: new Map([['local-datacenters', layer]]),
        isEnabled: () => false,
        subscribeVisibilityRequests: () => {
          if (throwAt === 'intent')
            throw new Error('controlled intent setup failure');
          return () => {
            intentUnsubscribed++;
          };
        },
      },
    },
  };
  Object.assign(window, makeEvents('window', window));
  class FakeObserver {
    static supportedEntryTypes = ['event'];
    constructor(callback) {
      observerCallback = callback;
    }
    observe(options) {
      assert.deepEqual(JSON.parse(JSON.stringify(options)), {
        type: 'event',
        buffered: false,
        durationThreshold: 16,
      });
      if (throwAt === 'performance')
        throw new Error('controlled performance setup failure');
    }
    takeRecords() {
      const value = pendingEntries;
      pendingEntries = [];
      return value;
    }
    disconnect() {
      disconnected++;
    }
  }
  class FakeMutationObserver {
    constructor(callback) {
      mutationCallback = callback;
    }
    observe(target, options) {
      if (throwAt === 'mutation')
        throw new Error('controlled mutation setup failure');
      mutationTargets.push({ target, options });
    }
    disconnect() {
      mutationDisconnected++;
    }
  }
  let initializationError = null;
  try {
    runInNewContext(`(${installInteractionEventTimingInPage.toString()})()`, {
      window,
      document,
      PerformanceObserver: FakeObserver,
      MutationObserver: FakeMutationObserver,
      performance: { now: () => now },
      setTimeout: (callback, ms) => {
        assert.equal(ms, 1000);
        timers.set(1, callback);
        return 1;
      },
      clearTimeout: (id) => timers.delete(id),
    });
  } catch (error) {
    initializationError = error;
  }
  const api = window.__qualificationEventTiming;
  return {
    api,
    button,
    ancestor,
    window,
    document,
    listeners,
    timers,
    initializationError,
    mutationTargets,
    mutate: () => mutationCallback([]),
    setNow: (value) => {
      now = value;
    },
    deliver: (entries) => observerCallback({ getEntries: () => entries }),
    disconnected: () => ({
      disconnected,
      mutationDisconnected,
      intentUnsubscribed,
    }),
  };
}

test('native observer binds exact target, retains late delivery, and disposes every owned callback', async () => {
  const env = browserFixture();
  const sample = {
    generation: 1,
    clickAtMs: 10,
    expected: true,
    acceptedIntentEpoch: 1,
  };
  env.setNow(11);
  env.api.registerClick(sample, {
    isTrusted: true,
    type: 'click',
    timeStamp: 10,
    target: env.button,
  });
  env.api.witness(sample, 16, 'transition', 20);
  env.setNow(200);
  const drain = env.api.drain(1);
  assert.throws(() =>
    env.api.registerClick(
      { ...sample, generation: 2 },
      { isTrusted: true, type: 'click', timeStamp: 10, target: env.button },
    ),
  );
  env.setNow(1200);
  env.timers.get(1)();
  env.timers.delete(1);
  await drain;
  env.setNow(1201);
  env.deliver([
    {
      entryType: 'event',
      name: 'click',
      startTime: 10,
      duration: 64,
      processingStart: 10,
      processingEnd: 12,
      interactionId: 7,
      target: env.button,
    },
  ]);
  assert.equal(env.api.read().entries[0].deliveredAtMs, 1201);
  assert.equal(env.api.read().entries[0].targetMatched, true);
  env.api.dispose();
  env.api.dispose();
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
  assert.equal(env.window.__qualificationEventTiming, undefined);
  assert.deepEqual(env.disconnected(), {
    disconnected: 1,
    mutationDisconnected: 1,
    intentUnsubscribed: 1,
  });
});

test('disposing during drain rejects the pending operation and releases its timer', async () => {
  const env = browserFixture();
  env.api.registerClick(
    { generation: 1, clickAtMs: 10, expected: true },
    { isTrusted: true, type: 'click', timeStamp: 10, target: env.button },
  );
  const drain = env.api.drain(1);
  env.api.dispose();
  await assert.rejects(drain, /disposed/);
  assert.equal(env.timers.size, 0);
});

test('detached/replaced button and invisible/clipped ancestry cannot prove visible feedback', () => {
  for (const mutate of [
    (env) => {
      env.button.isConnected = false;
    },
    (env) => {
      env.document.querySelector = () => ({});
    },
    (env) => {
      env.ancestor.style.opacity = '0';
    },
    (env) => {
      env.ancestor.style.overflowY = 'hidden';
      env.ancestor.rect.bottom = 0;
    },
  ]) {
    const env = browserFixture();
    assert.ok(
      env.mutationTargets.some(
        ({ target, options }) =>
          target === env.ancestor && options.childList === true,
      ),
    );
    const sample = {
      generation: 1,
      clickAtMs: 10,
      expected: true,
      acceptedIntentEpoch: 1,
    };
    env.api.registerClick(sample, {
      isTrusted: true,
      type: 'click',
      timeStamp: 10,
      target: env.button,
    });
    env.api.witness(sample, 16, 'transition', 20);
    assert.equal(env.api.read().actions[0].witness.visible, true);
    mutate(env);
    env.setNow(30);
    env.mutate();
    assert.equal(env.api.read().observations.at(-1).invalid, true);
    env.api.dispose();
  }
  const env = browserFixture();
  const sample = {
    generation: 1,
    clickAtMs: 10,
    expected: true,
    acceptedIntentEpoch: 1,
  };
  env.api.registerClick(sample, {
    isTrusted: true,
    type: 'click',
    timeStamp: 10,
    target: env.button,
  });
  env.ancestor.style.opacity = '0';
  env.api.witness(sample, 16, 'transition', 20);
  assert.equal(env.api.read().actions[0].witness.visible, false);
  env.api.dispose();
});

test('observer installation rolls back native callbacks when any setup step throws', () => {
  for (const throwAt of ['performance', 'mutation', 'intent']) {
    const env = browserFixture({ throwAt });
    assert.match(env.initializationError?.message || '', /controlled/);
    assert.equal(env.api, undefined);
    assert.equal(env.listeners.size, 0);
    assert.equal(env.timers.size, 0);
    assert.equal(env.disconnected().disconnected, 1);
    if (throwAt !== 'performance')
      assert.equal(env.disconnected().mutationDisconnected, 1);
  }
});
