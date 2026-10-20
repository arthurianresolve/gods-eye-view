import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import {
  installInteractionEventTimingInPage,
  INTERACTION_EVENT_TIMING_PLAN,
  INTERACTION_EVENT_TIMING_PLAN_V2,
  INTERACTION_EVENT_TIMING_PLAN_V4,
  assertInteractionEventTimingPlan,
  validateInteractionEventTiming,
} from './interactionEventTiming.mjs';

function geometryFixture() {
  return {
    controlRect: {
      left: 5,
      top: 5,
      right: 55,
      bottom: 25,
      width: 50,
      height: 20,
    },
    clipRect: { left: 5, top: 5, right: 55, bottom: 25 },
    scrollOffsets: [{ left: 0, top: 0 }],
  };
}

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
      buttonFeedbackSecondRafTimestampMs: clickAtMs + 32,
      buttonFeedbackState: 'transition',
      renderedFrameAtMs: clickAtMs + 200,
    };
  });
  const capture = {
    ...INTERACTION_EVENT_TIMING_PLAN,
    status: 'observed',
    installedAtMs: 1,
    overflow: false,
    work: {
      mutationCallbacks: 20,
      mutationRecords: 100,
      continuityChecks: 40,
      geometryChecks: 40,
      restoredMeasurementTransactions: 0,
      renderBoundaryArms: 0,
      renderBoundaryCallbacks: 0,
      overhead: { status: 'unavailable', reason: 'not-measured' },
    },
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
        completedAtMs: sample.clickAtMs + 21,
        rafTimestampMs: sample.clickAtMs + 16,
        intentEpoch: sample.acceptedIntentEpoch,
        expected: sample.expectedLayerEnabled,
        state: 'transition',
        generation: sample.generation,
        visible: true,
        focused: true,
        geometry: geometryFixture(),
      },
      renderBoundaryArms: 0,
      renderBoundaryProofs: [],
      renderBoundaryPendingAtDrainEnd: false,
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
  for (const action of capture.actions)
    action.witnesses = [
      action.witness,
      {
        ...action.witness,
        atMs: action.clickAtMs + 40,
        completedAtMs: action.clickAtMs + 41,
        rafTimestampMs: action.clickAtMs + 32,
      },
    ];
  return { samples, capture };
}

function addBoundaryRecovery(capture) {
  capture.work.restoredMeasurementTransactions++;
  capture.work.renderBoundaryArms++;
  capture.work.renderBoundaryCallbacks++;
  capture.work.geometryChecks++;
  capture.work.continuityChecks++;
  capture.observations.push({
    atMs: 1050,
    kind: 'unproven-geometry',
    generation: 1,
    invalid: true,
    reason: 'mutation-batch',
    mutation: {
      callback: 1,
      recordCount: 2,
      restoredMeasurementTransactions: 1,
      reasonCount: 1,
      reasonsTruncated: false,
      reasons: [
        {
          target: 'layout-root',
          attribute: 'data-rail-measuring',
          reason: 'restored-measurement',
        },
      ],
    },
  });
  const action = capture.actions[0];
  action.renderBoundaryArms = 1;
  action.renderBoundaryProofs.push({
    kind: 'resize-observer-initial',
    generation: 1,
    ordinal: 1,
    armedAtMs: 1051,
    armedByMutationCallback: 1,
    sourceMutationCallback: 1,
    observedThroughMutationCallback: 1,
    baseline: { kind: 'raf', ordinal: 2 },
    atMs: 1055,
    completedAtMs: 1056,
    intentEpoch: action.witness.intentEpoch,
    expected: action.expected,
    state: 'transition',
    visible: true,
    focused: true,
    geometry: geometryFixture(),
    restoredGeometry: true,
  });
}

function useFreshReproofPlan(capture) {
  Object.assign(capture, INTERACTION_EVENT_TIMING_PLAN_V4);
}

function mixedBoundaryFixture() {
  const value = fixture();
  addBoundaryRecovery(value.capture);
  const mixed = value.capture.observations[0];
  mixed.mutation.recordCount++;
  mixed.mutation.reasonCount++;
  mixed.mutation.reasons.push({
    target: 'other',
    attribute: 'none',
    reason: 'child-list',
  });
  const pure = structuredClone(mixed);
  pure.atMs = 1052;
  pure.mutation.callback = 2;
  pure.mutation.recordCount = 2;
  pure.mutation.reasonCount = 1;
  pure.mutation.reasons.pop();
  value.capture.observations.push(pure);
  value.capture.work.restoredMeasurementTransactions++;
  Object.assign(value.capture.actions[0].renderBoundaryProofs[0], {
    armedAtMs: 1053,
    armedByMutationCallback: 2,
    sourceMutationCallback: 2,
    observedThroughMutationCallback: 2,
  });
  return value;
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
    (value) => {
      value.policy = 'trusted-click-event-timing-visible-intent-v1';
    },
    (value) => {
      value.work.geometryChecks = 41;
    },
    (value) => {
      value.work.mutationRecords = 65537;
    },
    (value) => {
      value.work.mutationCallbacks = Infinity;
    },
  ]) {
    const changed = structuredClone(capture);
    corrupt(changed);
    assert.throws(() => validateInteractionEventTiming(changed, samples));
  }
});

test('first visible same-intent state must precede earliest rendering endpoint; overlap is rejected', () => {
  const { samples, capture } = fixture();
  capture.actions[0].witnesses[1].atMs = samples[0].clickAtMs + 80;
  capture.actions[0].witnesses[1].completedAtMs = samples[0].clickAtMs + 81;
  samples[0].buttonFeedbackAtMs = capture.actions[0].witnesses[1].atMs;
  capture.actions[0].witness.atMs = samples[0].clickAtMs + 60;
  capture.actions[0].witness.completedAtMs = samples[0].clickAtMs + 60;
  samples[0].buttonFeedbackFirstFrameAtMs = capture.actions[0].witness.atMs;
  validateInteractionEventTiming(capture, samples);
  capture.actions[0].witness.atMs++;
  capture.actions[0].witness.completedAtMs++;
  samples[0].buttonFeedbackFirstFrameAtMs++;
  assert.throws(
    () => validateInteractionEventTiming(capture, samples),
    /earliest/,
  );
  capture.actions[0].witness.atMs--;
  capture.actions[0].witness.completedAtMs--;
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
    { atMs: 1050, kind: 'contrary-button-state', invalid: true },
    {
      atMs: 1050,
      kind: 'unproven-geometry',
      reason: 'window-scroll',
      invalid: true,
    },
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

test('only a later existing RAF before the rendering endpoint can recover geometry uncertainty', () => {
  const { samples, capture } = fixture();
  capture.observations.push({
    atMs: 1030,
    kind: 'unproven-geometry',
    reason: 'window-scroll',
    generation: 1,
    invalid: true,
  });
  capture.actions[0].witnesses[1].state = 'settled';
  samples[0].buttonFeedbackState = 'settled';
  validateInteractionEventTiming(capture, samples);
  capture.actions[0].witnesses[1].atMs = 1061;
  capture.actions[0].witnesses[1].completedAtMs = 1062;
  samples[0].buttonFeedbackAtMs = 1061;
  assert.throws(
    () => validateInteractionEventTiming(capture, samples),
    /changed before rendering/,
  );
  capture.actions[0].witnesses[1].atMs = 1040;
  capture.actions[0].witnesses[1].completedAtMs = 1041;
  samples[0].buttonFeedbackAtMs = 1040;
  capture.actions[0].witnesses[1].visible = false;
  assert.throws(
    () => validateInteractionEventTiming(capture, samples),
    /Latest eligible geometry proof/,
  );
});

test('later negative proofs cannot be skipped, including the quantization uncertainty interval', () => {
  for (const atMs of [1040, 1062]) {
    const { samples, capture } = fixture();
    const second = capture.actions[0].witnesses[1];
    second.atMs = atMs;
    second.completedAtMs = atMs + 1;
    second.visible = false;
    samples[0].buttonFeedbackAtMs = atMs;
    assert.throws(
      () => validateInteractionEventTiming(capture, samples),
      /geometry proof/,
    );
  }
  const recovered = fixture();
  recovered.capture.actions[0].witness.visible = false;
  assert.throws(
    () => validateInteractionEventTiming(recovered.capture, recovered.samples),
    /geometry proof/,
  );
  recovered.capture.policy = INTERACTION_EVENT_TIMING_PLAN_V2.policy;
  validateInteractionEventTiming(recovered.capture, recovered.samples);
});

test('a visibility check finishing after the earliest endpoint cannot prove an earlier render', () => {
  const { samples, capture } = fixture();
  capture.observations.push({
    atMs: 1030,
    kind: 'unproven-geometry',
    reason: 'window-scroll',
    invalid: true,
  });
  capture.actions[0].witnesses[1].completedAtMs = 1061;
  assert.throws(
    () => validateInteractionEventTiming(capture, samples),
    /changed before rendering/,
  );
  capture.actions[0].witnesses[1].completedAtMs = 1039;
  assert.throws(() => validateInteractionEventTiming(capture, samples));
});

function browserFixture({ throwAt = null, installerOptions } = {}) {
  let now = 1;
  let observerCallback;
  let pendingEntries = [];
  let disconnected = 0;
  let mutationDisconnected = 0;
  let intentUnsubscribed = 0;
  let mutationCallback;
  let renderCallback;
  let renderObserved = false;
  let renderObserveCalls = 0;
  let renderDisconnected = 0;
  let geometryReads = 0;
  let mutationPhase = false;
  let pendingMutations = [];
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
  function geometryRead(value) {
    assert.equal(mutationPhase, false, 'Mutation delivery forced layout');
    geometryReads++;
    return value;
  }
  const ancestor = {
    id: 'left-panel-stack',
    parentElement: null,
    scrollLeft: 0,
    scrollTop: 0,
    style: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      overflowX: 'visible',
      overflowY: 'visible',
    },
    rect: { left: 0, top: 0, right: 100, bottom: 100 },
    attributes: { style: '' },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    getBoundingClientRect() {
      return geometryRead(this.rect);
    },
  };
  const button = {
    parentElement: ancestor,
    closest: () => ancestor,
    isConnected: true,
    checkVisibility: () => geometryRead(true),
    children: [],
    disabled: false,
    textContent: 'ENABLING',
    dataset: { feedState: 'enabling' },
    attributes: {
      class: 'data-toggle-btn transitioning enabling',
      'aria-busy': 'true',
      'aria-disabled': 'true',
      'data-feed-state': 'enabling',
    },
    classList: {
      contains: (name) => button.attributes.class.split(' ').includes(name),
    },
    getAttribute: (name) => button.attributes[name] ?? null,
    contains: () => false,
    rect: {
      width: 50,
      height: 20,
      left: 5,
      top: 5,
      right: 55,
      bottom: 25,
    },
    getBoundingClientRect: () => geometryRead(button.rect),
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
      geometryRead(
        node.style || { display: 'block', visibility: 'visible', opacity: '1' },
      ),
    __godsEyeView: {
      dataManager: {
        layers: new Map([['local-datacenters', layer]]),
        isEnabled: () => button.classList.contains('active'),
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
    takeRecords() {
      const records = pendingMutations;
      pendingMutations = [];
      return records;
    }
  }
  class FakeResizeObserver {
    constructor(callback) {
      if (throwAt === 'render-constructor')
        throw new Error('controlled render observer setup failure');
      renderCallback = callback;
    }
    observe(target) {
      assert.equal(target, button);
      renderObserveCalls++;
      if (throwAt === 'render-observe')
        throw new Error('controlled render observer arm failure');
      renderObserved = true;
    }
    unobserve(target) {
      assert.equal(target, button);
      renderObserved = false;
    }
    disconnect() {
      renderObserved = false;
      renderDisconnected++;
    }
  }
  let initializationError = null;
  try {
    runInNewContext(
      `(${installInteractionEventTimingInPage.toString()})(installerOptions)`,
      {
        installerOptions,
        window,
        document,
        PerformanceObserver: FakeObserver,
        MutationObserver: FakeMutationObserver,
        ResizeObserver: FakeResizeObserver,
        performance: { now: () => now },
        setTimeout: (callback, ms) => {
          assert.equal(ms, 1000);
          timers.set(1, callback);
          return 1;
        },
        clearTimeout: (id) => timers.delete(id),
      },
    );
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
    mutate: (records = []) => {
      mutationPhase = true;
      try {
        mutationCallback(records);
      } finally {
        mutationPhase = false;
      }
    },
    queueMutations: (records) => {
      pendingMutations = records;
    },
    geometryReads: () => geometryReads,
    render: (entries = [{ target: button }]) => renderCallback(entries),
    renderState: () => ({
      renderObserved,
      renderObserveCalls,
      renderDisconnected,
    }),
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
    env.ancestor.attributes.style = 'changed';
    env.mutate([
      {
        type: 'attributes',
        target: env.ancestor,
        attributeName: 'style',
        oldValue: '',
      },
    ]);
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

function witness(env) {
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
  env.setNow(20);
  env.api.witness(sample, 16, 'transition', 20);
  env.setNow(30);
}

function measurementRecords(env) {
  return [
    {
      type: 'attributes',
      target: env.ancestor,
      attributeName: 'data-rail-measuring',
      oldValue: null,
    },
    {
      type: 'attributes',
      target: env.ancestor,
      attributeName: 'data-rail-measuring',
      oldValue: '',
    },
  ];
}

function mixedMeasurementRecords(env) {
  const name = 'data-available-height-pct';
  const previous = env.ancestor.attributes[name] ?? null;
  env.ancestor.attributes[name] = previous === '80' ? '81' : '80';
  return [
    ...measurementRecords(env),
    {
      type: 'attributes',
      target: env.ancestor,
      attributeName: name,
      oldValue: previous,
    },
  ];
}

test('mutation continuity permits paint-only active changes without any synchronous geometry reads', () => {
  const env = browserFixture();
  witness(env);
  const initialReads = env.geometryReads();
  env.button.attributes.class = 'data-toggle-btn active transitioning enabling';
  env.mutate([
    {
      type: 'attributes',
      target: env.button,
      attributeName: 'class',
      oldValue: 'data-toggle-btn transitioning enabling',
    },
    {
      type: 'attributes',
      target: env.button,
      attributeName: 'aria-busy',
      oldValue: 'true',
    },
    {
      type: 'attributes',
      target: env.button,
      attributeName: 'aria-disabled',
      oldValue: 'true',
    },
    {
      type: 'attributes',
      target: env.button,
      attributeName: 'data-feed-state',
      oldValue: 'enabling',
    },
    {
      type: 'childList',
      target: env.button,
      removedNodes: [{ nodeType: 3, data: 'ENABLING' }],
      addedNodes: [{ nodeType: 3, data: 'ENABLING' }],
    },
  ]);
  assert.equal(env.geometryReads(), initialReads);
  const proof = env.api.read();
  assert.equal(proof.observations.length, 0);
  assert.equal(proof.work.geometryChecks, 1);
  assert.equal(proof.work.mutationCallbacks, 1);
  assert.equal(proof.work.mutationRecords, 5);
  assert.equal(proof.work.continuityChecks, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(proof.work.overhead)), {
    status: 'unavailable',
    reason: 'not-measured',
  });
  env.api.dispose();
});

test('active-class continuity exemption is limited to source-proven paint properties', () => {
  const css = readFileSync(
    new URL('../../src/ui/styles/radio.css', import.meta.url),
    'utf8',
  );
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) =>
    match[1].includes('.data-toggle-btn.active'),
  );
  assert.equal(rules.length, 4);
  const properties = new Set([
    'color',
    'border-color',
    'background',
    'box-shadow',
  ]);
  for (const [, , body] of rules)
    for (const declaration of body.split(';').filter((value) => value.trim()))
      assert.ok(properties.has(declaration.split(':')[0].trim()));
});

test('long control text and known width-changing classes remain unproven until a fresh RAF', () => {
  for (const mode of ['text', 'class', 'characterData']) {
    const env = browserFixture();
    witness(env);
    const before = env.geometryReads();
    if (mode === 'class') {
      const oldValue = env.button.attributes.class;
      env.button.attributes.class += ' feed-loading';
      env.mutate([
        {
          type: 'attributes',
          target: env.button,
          attributeName: 'class',
          oldValue,
        },
      ]);
    } else {
      env.button.textContent = 'ENABLING '.repeat(100);
      env.mutate(
        mode === 'text'
          ? [
              {
                type: 'childList',
                target: env.button,
                removedNodes: [{ nodeType: 3, data: 'ENABLING' }],
                addedNodes: [{ nodeType: 3, data: env.button.textContent }],
              },
            ]
          : [
              {
                type: 'characterData',
                target: {
                  parentNode: env.button,
                  data: env.button.textContent,
                },
                oldValue: 'ENABLING',
              },
            ],
      );
    }
    assert.equal(env.api.read().observations.at(-1).kind, 'unproven-geometry');
    assert.equal(env.geometryReads(), before);
    env.api.dispose();
  }
});

test('observer uses at most the two existing natural RAF proofs and no new frame callbacks', () => {
  const env = browserFixture();
  witness(env);
  const sample = {
    generation: 1,
    clickAtMs: 10,
    expected: true,
    acceptedIntentEpoch: 1,
  };
  env.button.attributes.class = 'data-toggle-btn active feed-nominal';
  env.button.dataset.feedState = 'nominal';
  env.button.textContent = 'ON';
  env.api.witness(sample, 32, 'settled', 40);
  const reads = env.geometryReads();
  env.api.witness(sample, 48, 'settled', 50);
  const proof = env.api.read();
  assert.equal(proof.actions[0].witnesses.length, 2);
  assert.equal(proof.actions[0].witnesses[1].state, 'settled');
  assert.equal(proof.actions[0].witnesses[1].visible, true);
  assert.equal(proof.work.geometryChecks, 2);
  assert.equal(env.geometryReads(), reads);
  env.api.dispose();
});

test('sibling text changes and transient unknown styling fail closed; true no-op writes are harmless', () => {
  const env = browserFixture();
  witness(env);
  const sibling = { parentNode: env.ancestor, data: '12' };
  assert.ok(
    env.mutationTargets.some(
      ({ target, options }) =>
        target === env.ancestor &&
        options.subtree &&
        options.characterData &&
        options.characterDataOldValue &&
        options.attributeOldValue,
    ),
  );
  env.mutate([
    {
      type: 'attributes',
      target: env.ancestor,
      attributeName: 'style',
      oldValue: '',
    },
    { type: 'characterData', target: sibling, oldValue: '12' },
    {
      type: 'childList',
      target: env.ancestor,
      removedNodes: [{ nodeType: 3, data: '12' }],
      addedNodes: [{ nodeType: 3, data: '12' }],
    },
  ]);
  assert.equal(env.api.read().observations.length, 0);
  sibling.data = '12345';
  env.mutate([{ type: 'characterData', target: sibling, oldValue: '12' }]);
  assert.equal(env.api.read().observations.at(-1).kind, 'unproven-geometry');
  env.mutate([
    {
      type: 'attributes',
      target: env.ancestor,
      attributeName: 'style',
      oldValue: '',
    },
    {
      type: 'attributes',
      target: env.ancestor,
      attributeName: 'style',
      oldValue: 'opacity:0',
    },
  ]);
  assert.equal(env.api.read().observations.length, 2);
  env.button.attributes.class += ' arbitrary-hidden-class';
  env.mutate([
    {
      type: 'attributes',
      target: env.button,
      attributeName: 'class',
      oldValue: 'data-toggle-btn transitioning enabling',
    },
  ]);
  assert.equal(env.api.read().observations.length, 3);
  env.api.dispose();
});

test('pending removal, resize and scroll invalidate continuity without remeasuring layout', () => {
  const env = browserFixture();
  witness(env);
  const initialReads = env.geometryReads();
  env.queueMutations([
    {
      type: 'childList',
      target: env.ancestor,
      addedNodes: [],
      removedNodes: [env.button],
    },
  ]);
  assert.equal(env.api.read().observations.at(-1).kind, 'unproven-geometry');
  for (const name of ['scroll', 'resize'])
    env.listeners.get(`window:${name}`).callback();
  assert.equal(env.api.read().observations.length, 3);
  assert.equal(env.geometryReads(), initialReads);
  env.api.dispose();
  assert.equal(env.listeners.size, 0);
});

test('mutation deliveries and record work are bounded even when all writes are unchanged', () => {
  for (const mode of ['callbacks', 'records']) {
    const env = browserFixture();
    witness(env);
    if (mode === 'callbacks')
      for (let index = 0; index < 4097; index++) env.mutate([]);
    else env.mutate(Array(65537).fill({}));
    const proof = env.api.read();
    assert.equal(proof.overflow, true);
    assert.equal(proof.work.geometryChecks, 1);
    assert.equal(env.disconnected().mutationDisconnected, 1);
    env.api.dispose();
  }
});

test('v3 source-owned restoration remains uncertain until an unchanged post-layout proof', () => {
  const env = browserFixture();
  witness(env);
  const panel = {
    id: 'data-panel',
    parentElement: env.ancestor,
    attributes: { style: '--left-panel-allocated-height: 470.0px;' },
    classList: { contains: () => false },
    getAttribute(name) {
      return name === 'data-panel-id'
        ? this.id
        : (this.attributes[name] ?? null);
    },
  };
  const before = env.geometryReads();
  env.setNow(45);
  env.mutate([
    {
      type: 'attributes',
      target: env.ancestor,
      attributeName: 'data-rail-measuring',
      oldValue: null,
    },
    {
      type: 'attributes',
      target: panel,
      attributeName: 'style',
      oldValue: panel.attributes.style,
    },
    { type: 'attributes', target: panel, attributeName: 'style', oldValue: '' },
    {
      type: 'attributes',
      target: env.ancestor,
      attributeName: 'data-rail-measuring',
      oldValue: '',
    },
  ]);
  const proof = env.api.read();
  assert.equal(proof.policy, INTERACTION_EVENT_TIMING_PLAN.policy);
  assert.equal(proof.work.restoredMeasurementTransactions, 2);
  assert.equal(proof.observations.length, 1);
  assert.equal(proof.observations[0].kind, 'unproven-geometry');
  assert.equal(proof.observations[0].invalid, true);
  assert.equal(proof.observations[0].mutation.recordCount, 4);
  assert.equal(proof.observations[0].mutation.reasonCount, 2);
  assert.deepEqual(
    Array.from(proof.observations[0].mutation.reasons, (x) => x.reason),
    ['restored-measurement', 'restored-measurement'],
  );
  assert.equal(
    env.geometryReads(),
    before,
    'Restoration handling must not read layout',
  );
  assert.equal(proof.actions[0].renderBoundaryProofs.length, 0);
  assert.equal(env.renderState().renderObserved, true);
  env.setNow(50);
  env.render();
  const boundary = env.api.read().actions[0].renderBoundaryProofs[0];
  assert.equal(boundary.visible, true);
  assert.equal(boundary.restoredGeometry, true);
  assert.equal(
    boundary.sourceMutationCallback,
    proof.observations[0].mutation.callback,
  );
  assert.equal(env.renderState().renderObserved, false);
  env.api.dispose();
});

test('restoration never hides genuine height, clipping, visibility, motion or ownership changes', () => {
  for (const [initial, final] of [
    [
      '--left-panel-allocated-height: 470.0px;',
      '--left-panel-allocated-height: 471.0px;',
    ],
    ['opacity: 1;', 'opacity: 0;'],
    ['overflow: visible;', 'overflow: hidden; height: 0px;'],
    ['transform: none;', 'transform: translateX(-9999px);'],
    ['display: block;', 'display: none;'],
    ['opacity: 1;', 'opacity: 1;'],
    ['animation: reveal 1s;', 'animation: reveal 1s;'],
  ]) {
    const env = browserFixture();
    witness(env);
    const panel = {
      id: 'data-panel',
      parentElement: env.ancestor,
      classList: { contains: () => false },
      getAttribute: (name) => (name === 'data-panel-id' ? 'data-panel' : final),
    };
    const before = env.geometryReads();
    env.mutate([
      {
        type: 'attributes',
        target: panel,
        attributeName: 'style',
        oldValue: initial,
      },
      {
        type: 'attributes',
        target: panel,
        attributeName: 'style',
        oldValue: '',
      },
    ]);
    const observation = env.api.read().observations.at(-1);
    assert.equal(observation.kind, 'unproven-geometry');
    assert.equal(observation.invalid, true);
    assert.equal(env.geometryReads(), before);
    env.api.dispose();
  }
  for (const corruption of [
    'wrong-parent',
    'unknown-panel',
    'collapsed',
    'floating',
    'extra-property',
  ]) {
    const env = browserFixture();
    witness(env);
    const value =
      corruption === 'extra-property'
        ? '--left-panel-allocated-height: 470.0px; opacity: 0;'
        : '--left-panel-allocated-height: 470.0px;';
    const panel = {
      id: corruption === 'unknown-panel' ? 'unknown-panel' : 'data-panel',
      parentElement: corruption === 'wrong-parent' ? {} : env.ancestor,
      classList: {
        contains: (name) =>
          (corruption === 'collapsed' && name === 'collapsed') ||
          (corruption === 'floating' && name === 'panel-floating'),
      },
      getAttribute(name) {
        return name === 'data-panel-id' ? this.id : value;
      },
    };
    env.mutate([
      {
        type: 'attributes',
        target: panel,
        attributeName: 'style',
        oldValue: value,
      },
      {
        type: 'attributes',
        target: panel,
        attributeName: 'style',
        oldValue: '',
      },
    ]);
    assert.equal(env.api.read().observations.at(-1).invalid, true);
    assert.equal(env.api.read().work.restoredMeasurementTransactions, 0);
    env.api.dispose();
  }
});

test('a marker left active or restored in a later delivery remains unproven', () => {
  const env = browserFixture();
  witness(env);
  env.ancestor.attributes['data-rail-measuring'] = '';
  env.mutate([
    {
      type: 'attributes',
      target: env.ancestor,
      attributeName: 'data-rail-measuring',
      oldValue: null,
    },
  ]);
  delete env.ancestor.attributes['data-rail-measuring'];
  env.mutate([
    {
      type: 'attributes',
      target: env.ancestor,
      attributeName: 'data-rail-measuring',
      oldValue: '',
    },
  ]);
  const proof = env.api.read();
  assert.equal(proof.observations.length, 2);
  assert.ok(
    proof.observations.every(
      (x) => x.invalid && x.kind === 'unproven-geometry',
    ),
  );
  assert.equal(proof.work.restoredMeasurementTransactions, 0);
  env.api.dispose();
});

test('mutation reasons are bounded categories and never retain attributes, text, IDs or URLs', () => {
  const env = browserFixture();
  witness(env);
  const secret = 'private-analyst-text-https://private.invalid/path';
  const targets = Array.from({ length: 20 }, () => ({
    id: secret,
    getAttribute: () => secret,
  }));
  const before = env.geometryReads();
  env.mutate(
    targets.map((target) => ({
      type: 'attributes',
      target,
      attributeName: secret,
      oldValue: null,
    })),
  );
  const proof = env.api.read(),
    detail = proof.observations.at(-1).mutation;
  assert.equal(detail.recordCount, 20);
  assert.equal(detail.reasonCount, 20);
  assert.equal(detail.reasons.length, 8);
  assert.equal(detail.reasonsTruncated, true);
  assert.ok(
    detail.reasons.every(
      (x) =>
        x.target === 'other' &&
        x.attribute === 'other' &&
        x.reason === 'changed-attribute',
    ),
  );
  assert.equal(JSON.stringify(proof).includes(secret), false);
  assert.equal(env.geometryReads(), before);
  env.api.dispose();
});

test('versioned consumer validates restoration metadata and preserves the strict v2 failure path', () => {
  assertInteractionEventTimingPlan(INTERACTION_EVENT_TIMING_PLAN);
  assertInteractionEventTimingPlan(INTERACTION_EVENT_TIMING_PLAN_V2);
  const { capture, samples } = fixture();
  addBoundaryRecovery(capture);
  validateInteractionEventTiming(capture, samples);
  for (const mutate of [
    (x) => {
      x.work.restoredMeasurementTransactions = 0;
    },
    (x) => {
      x.observations[0].mutation.reasons[0].attribute = 'class';
    },
    (x) => {
      x.observations[0].mutation.reasons.push(
        x.observations[0].mutation.reasons[0],
      );
    },
    (x) => {
      x.observations[0].mutation.reasons[0].oldValue = 'private';
    },
    (x) => {
      x.observations[0].mutation.recordCount = 1;
    },
    (x) => {
      x.observations[0].invalid = false;
    },
  ]) {
    const bad = structuredClone(capture);
    mutate(bad);
    assert.throws(() => validateInteractionEventTiming(bad, samples));
  }
  const legacy = fixture();
  legacy.capture.policy = INTERACTION_EVENT_TIMING_PLAN_V2.policy;
  delete legacy.capture.measurementRestoration;
  delete legacy.capture.maximumMutationReasonsPerObservation;
  delete legacy.capture.maximumRenderBoundaryProofsPerAction;
  delete legacy.capture.work.restoredMeasurementTransactions;
  delete legacy.capture.work.renderBoundaryArms;
  delete legacy.capture.work.renderBoundaryCallbacks;
  validateInteractionEventTiming(legacy.capture, legacy.samples);
  legacy.capture.observations.push({
    atMs: 1050,
    kind: 'unproven-geometry',
    invalid: true,
    generation: 1,
  });
  assert.throws(
    () => validateInteractionEventTiming(legacy.capture, legacy.samples),
    /Visible feedback or intent changed/,
  );
});

test('post-layout recovery cannot accept a shifted/clipped control, late proof, unknown change or missing ownership', () => {
  for (const corrupt of [
    (x) => {
      x.actions[0].renderBoundaryProofs[0].geometry.scrollOffsets[0].top = 260;
      x.actions[0].renderBoundaryProofs[0].restoredGeometry = false;
    },
    (x) => {
      const p = x.actions[0].renderBoundaryProofs[0];
      p.geometry.controlRect.left++;
      p.geometry.controlRect.right++;
      p.restoredGeometry = false;
    },
    (x) => {
      x.actions[0].renderBoundaryProofs[0].visible = false;
    },
    (x) => {
      x.actions[0].renderBoundaryProofs[0].completedAtMs = 1061;
    },
    (x) => {
      x.actions[0].renderBoundaryProofs[0].atMs = 1062;
      x.actions[0].renderBoundaryProofs[0].completedAtMs = 1063;
      x.actions[0].renderBoundaryProofs[0].visible = false;
    },
    (x) => {
      x.actions[0].renderBoundaryProofs[0].sourceMutationCallback = 2;
    },
    (x) => {
      x.actions[0].renderBoundaryProofs[0].baseline.ordinal = 1;
    },
    (x) => {
      x.actions[0].renderBoundaryProofs[0].generation = 2;
    },
    (x) => {
      x.actions[0].renderBoundaryPendingAtDrainEnd = true;
    },
    (x) => {
      x.actions[0].renderBoundaryProofs = [];
    },
    (x) => {
      x.observations.push({
        atMs: 1052,
        kind: 'unproven-geometry',
        generation: 1,
        invalid: true,
        reason: 'window-resize',
      });
    },
    (x) => {
      x.observations.push({
        atMs: 1058,
        kind: 'unproven-geometry',
        generation: 1,
        invalid: true,
        reason: 'window-scroll',
      });
    },
  ]) {
    const { capture, samples } = fixture();
    addBoundaryRecovery(capture);
    corrupt(capture);
    assert.throws(() => validateInteractionEventTiming(capture, samples));
  }
  const absent = fixture();
  addBoundaryRecovery(absent.capture);
  absent.capture.actions[0].renderBoundaryProofs = [];
  absent.capture.actions[0].renderBoundaryArms = 0;
  absent.capture.work.geometryChecks--;
  absent.capture.work.renderBoundaryCallbacks = 0;
  absent.capture.work.renderBoundaryArms = 0;
  assert.throws(
    () => validateInteractionEventTiming(absent.capture, absent.samples),
    /eligible post-layout proof/,
  );
});

test('v3 negative proofs and pending measurements cannot be erased by later RAFs or late RO delivery', () => {
  for (const mode of [
    'negative-ro',
    'negative-raf',
    'late-ro',
    'stale-batch',
    'mixed-batch',
    'mixed-bracketed',
  ]) {
    const { capture, samples } = fixture();
    addBoundaryRecovery(capture);
    const action = capture.actions[0],
      proof = action.renderBoundaryProofs[0];
    if (mode === 'mixed-bracketed') {
      const first = capture.observations[0];
      first.atMs = 1030;
      const mixed = structuredClone(first);
      mixed.atMs = 1032;
      mixed.mutation.callback = 2;
      mixed.mutation.recordCount++;
      mixed.mutation.reasonCount++;
      mixed.mutation.reasons.push({
        target: 'other',
        attribute: 'class',
        reason: 'changed-attribute',
      });
      const last = structuredClone(first);
      last.atMs = 1034;
      last.mutation.callback = 3;
      capture.observations.push(mixed, last);
      capture.work.restoredMeasurementTransactions = 3;
      proof.armedAtMs = 1031;
      proof.sourceMutationCallback = 3;
      proof.observedThroughMutationCallback = 3;
      proof.atMs = 1035;
      proof.completedAtMs = 1036;
      proof.baseline.ordinal = 1;
      samples[0].buttonFeedbackAtMs = 1050;
      action.witnesses[1].atMs = 1050;
      action.witnesses[1].completedAtMs = 1051;
    } else if (mode === 'mixed-batch') {
      const batch = capture.observations[0];
      batch.atMs = 1030;
      batch.mutation.recordCount++;
      batch.mutation.reasonCount++;
      batch.mutation.reasons.push({
        target: 'other',
        attribute: 'class',
        reason: 'changed-attribute',
      });
      action.renderBoundaryArms = 0;
      action.renderBoundaryProofs = [];
      capture.work.renderBoundaryArms = 0;
      capture.work.renderBoundaryCallbacks = 0;
      capture.work.geometryChecks--;
      capture.work.continuityChecks--;
    } else if (mode === 'stale-batch') {
      const later = structuredClone(capture.observations[0]);
      later.atMs = 1052;
      later.mutation.callback = 2;
      capture.observations.push(later);
      capture.work.restoredMeasurementTransactions++;
      proof.observedThroughMutationCallback = 2;
    } else {
      capture.observations[0].atMs = 1030;
      proof.armedAtMs = 1031;
      proof.baseline.ordinal = 1;
      if (mode === 'negative-ro') {
        proof.atMs = 1035;
        proof.completedAtMs = 1036;
        proof.visible = false;
        samples[0].buttonFeedbackAtMs = 1050;
        action.witnesses[1].atMs = 1050;
        action.witnesses[1].completedAtMs = 1051;
      } else if (mode === 'negative-raf') action.witnesses[1].visible = false;
      else {
        proof.atMs = 1090;
        proof.completedAtMs = 1091;
      }
    }
    assert.throws(
      () => validateInteractionEventTiming(capture, samples),
      /post-layout|geometry proof|coalesced/,
    );
  }
});

test('fresh-reproof policy is explicit and leaves the v3 default unchanged', () => {
  assertInteractionEventTimingPlan(INTERACTION_EVENT_TIMING_PLAN_V4);
  const { policy, feedbackReproof, ...limits } =
    INTERACTION_EVENT_TIMING_PLAN_V4;
  assert.equal(policy, 'trusted-click-event-timing-visible-intent-v4');
  assert.equal(
    feedbackReproof,
    'same-intent-current-geometry-raf-or-owned-ro-v1',
  );
  const { policy: oldPolicy, ...oldLimits } = INTERACTION_EVENT_TIMING_PLAN;
  assert.equal(oldPolicy, 'trusted-click-event-timing-visible-intent-v3');
  assert.deepEqual(limits, oldLimits);
  const { capture, samples } = mixedBoundaryFixture();
  assert.throws(
    () => validateInteractionEventTiming(capture, samples),
    /post-layout/,
  );
  useFreshReproofPlan(capture);
  assert.deepEqual(
    validateInteractionEventTiming(capture, samples),
    Array(20).fill(64),
  );
  delete capture.feedbackReproof;
  assert.throws(() => validateInteractionEventTiming(capture, samples));
  assert.throws(() =>
    assertInteractionEventTimingPlan({
      ...INTERACTION_EVENT_TIMING_PLAN_V4,
      feedbackReproof: 'unknown',
    }),
  );
});

test('explicit v4 installer selection changes only declared metadata, not observation or drain work', async () => {
  const captures = [];
  for (const installerOptions of [
    {},
    { policy: INTERACTION_EVENT_TIMING_PLAN_V4.policy },
  ]) {
    const env = browserFixture({ installerOptions });
    witness(env);
    env.mutate(measurementRecords(env));
    env.setNow(40);
    env.render();
    env.setNow(50);
    env.api.witness(
      { generation: 1, acceptedIntentEpoch: 1, expected: true },
      48,
      'transition',
      50,
    );
    env.setNow(80);
    env.deliver([
      {
        entryType: 'event',
        name: 'click',
        startTime: 10,
        duration: 64,
        processingStart: 10.5,
        processingEnd: 13,
        interactionId: 7,
        target: env.button,
      },
    ]);
    env.setNow(200);
    const drain = env.api.drain(1);
    env.setNow(1200);
    env.timers.get(1)();
    env.timers.delete(1);
    await drain;
    captures.push(structuredClone(env.api.read()));
    env.api.dispose();
    assert.equal(env.listeners.size, 0);
    assert.equal(env.timers.size, 0);
    assert.equal(env.renderState().renderObserved, false);
  }
  const { policy: oldPolicy, ...oldCapture } = captures[0];
  const { policy: newPolicy, feedbackReproof, ...newCapture } = captures[1];
  assert.equal(oldPolicy, INTERACTION_EVENT_TIMING_PLAN.policy);
  assert.equal(newPolicy, INTERACTION_EVENT_TIMING_PLAN_V4.policy);
  assert.equal(
    feedbackReproof,
    INTERACTION_EVENT_TIMING_PLAN_V4.feedbackReproof,
  );
  assert.equal('feedbackReproof' in oldCapture, false);
  assert.deepEqual(newCapture, oldCapture);
});

test('v4 mixed source measurement arms a real owned post-layout proof and its produced twenty-action capture validates', async () => {
  const { samples } = fixture();
  const env = browserFixture({
    installerOptions: { policy: INTERACTION_EVENT_TIMING_PLAN_V4.policy },
  });
  for (const sample of samples) {
    const desired = sample.expectedLayerEnabled;
    const transition = desired ? 'enabling' : 'disabling';
    env.button.attributes.class = `data-toggle-btn transitioning ${transition}`;
    env.button.dataset.feedState = transition;
    const layer =
      env.window.__godsEyeView.dataManager.layers.get('local-datacenters');
    layer.visibilityIntentEpoch = sample.acceptedIntentEpoch;
    layer.visibilityIntentEnabled = desired;
    env.setNow(sample.clickAtMs);
    env.api.registerClick(
      {
        generation: sample.generation,
        clickAtMs: sample.clickAtMs,
        expected: desired,
      },
      {
        isTrusted: true,
        type: 'click',
        timeStamp: sample.clickAtMs,
        target: env.button,
      },
    );
    const witnessSample = {
      generation: sample.generation,
      acceptedIntentEpoch: sample.acceptedIntentEpoch,
      expected: desired,
    };
    env.setNow(sample.buttonFeedbackFirstFrameAtMs);
    env.api.witness(
      witnessSample,
      sample.buttonFeedbackFirstRafTimestampMs,
      'transition',
      sample.buttonFeedbackFirstFrameAtMs,
    );
    env.setNow(sample.clickAtMs + 30);
    const reads = env.geometryReads();
    env.mutate(mixedMeasurementRecords(env));
    assert.equal(
      env.geometryReads(),
      reads,
      'Mixed arming must not read geometry/style/visibility inside MO',
    );
    assert.equal(env.renderState().renderObserved, true);
    env.setNow(sample.buttonFeedbackAtMs);
    env.api.witness(
      witnessSample,
      sample.buttonFeedbackSecondRafTimestampMs,
      'transition',
      sample.buttonFeedbackAtMs,
    );
    env.setNow(sample.clickAtMs + 50);
    env.render();
    const action = env.api.read().actions.at(-1);
    assert.equal(action.renderBoundaryArms, 1);
    assert.equal(action.renderBoundaryProofs[0].visible, true);
    assert.equal(action.renderBoundaryProofs[0].restoredGeometry, true);
    assert.equal(
      action.renderBoundaryProofs[0].armedByMutationCallback,
      action.renderBoundaryProofs[0].sourceMutationCallback,
    );
    env.setNow(sample.clickAtMs + 80);
    env.deliver([
      {
        entryType: 'event',
        name: 'click',
        startTime: sample.clickAtMs,
        duration: 64,
        processingStart: sample.clickAtMs + 0.5,
        processingEnd: sample.clickAtMs + 3,
        interactionId: sample.generation * 7,
        target: env.button,
      },
    ]);
    env.setNow(sample.clickAtMs + 200);
    const drain = env.api.drain(sample.generation);
    env.setNow(sample.clickAtMs + 1200);
    env.timers.get(1)();
    env.timers.delete(1);
    await drain;
  }
  const capture = structuredClone(env.api.read());
  assert.equal(capture.work.renderBoundaryArms, 20);
  assert.equal(capture.work.renderBoundaryCallbacks, 20);
  assert.deepEqual(
    validateInteractionEventTiming(capture, samples),
    Array(20).fill(64),
  );
  const strict = structuredClone(capture);
  Object.assign(strict, INTERACTION_EVENT_TIMING_PLAN);
  delete strict.feedbackReproof;
  assert.throws(() => validateInteractionEventTiming(strict, samples));
  env.api.dispose();
  assert.equal(env.renderState().renderObserved, false);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);

  const legacy = browserFixture();
  witness(legacy);
  legacy.mutate(mixedMeasurementRecords(legacy));
  assert.equal(
    legacy.renderState().renderObserveCalls,
    0,
    'V3 acquisition retains the pure-source-only arm',
  );
  legacy.api.dispose();
});

test('v4 mixed recovery does not arm for departed controls, wrong intent/state or an already observed negative', () => {
  for (const mode of [
    'departed',
    'replaced',
    'intent',
    'state',
    'negative-raf',
    'negative-ro',
    'known-contrary',
  ]) {
    const env = browserFixture({
      installerOptions: { policy: INTERACTION_EVENT_TIMING_PLAN_V4.policy },
    });
    witness(env);
    if (mode === 'negative-raf') {
      env.ancestor.style.opacity = '0';
      env.setNow(25);
      env.api.witness(
        { generation: 1, acceptedIntentEpoch: 1, expected: true },
        24,
        'transition',
        25,
      );
      env.ancestor.style.opacity = '1';
    }
    if (mode === 'negative-ro') {
      env.mutate(measurementRecords(env));
      env.button.rect.top++;
      env.button.rect.bottom++;
      env.setNow(35);
      env.render();
      env.button.rect.top--;
      env.button.rect.bottom--;
      env.setNow(40);
      env.api.witness(
        { generation: 1, acceptedIntentEpoch: 1, expected: true },
        36,
        'transition',
        40,
      );
    }
    if (mode === 'known-contrary') {
      env.button.attributes.class = 'data-toggle-btn';
      env.mutate(mixedMeasurementRecords(env));
      assert.equal(
        env.api.read().observations.at(-1).kind,
        'contrary-button-state',
      );
      env.button.attributes.class = 'data-toggle-btn transitioning enabling';
    }
    if (mode === 'departed') env.button.isConnected = false;
    if (mode === 'replaced') env.document.querySelector = () => ({});
    if (mode === 'intent')
      env.window.__godsEyeView.dataManager.layers.get('local-datacenters')
        .visibilityIntentEpoch++;
    if (mode === 'state') env.button.attributes.class = 'data-toggle-btn';
    const before = env.renderState().renderObserveCalls;
    const reads = env.geometryReads();
    env.setNow(45);
    env.mutate(mixedMeasurementRecords(env));
    assert.equal(env.geometryReads(), reads, mode);
    assert.equal(env.renderState().renderObserveCalls, before, mode);
    assert.equal(env.renderState().renderObserved, false, mode);
    env.api.dispose();
  }
  const rightOnly = browserFixture({
    installerOptions: { policy: INTERACTION_EVENT_TIMING_PLAN_V4.policy },
  });
  witness(rightOnly);
  const right = { id: 'right-context-rail', getAttribute: () => null };
  rightOnly.mutate([
    {
      type: 'attributes',
      target: right,
      attributeName: 'data-rail-measuring',
      oldValue: null,
    },
    {
      type: 'attributes',
      target: right,
      attributeName: 'data-rail-measuring',
      oldValue: '',
    },
  ]);
  assert.equal(
    rightOnly.api.read().work.restoredMeasurementTransactions,
    0,
    'No right-rail transaction is silently recognized',
  );
  assert.equal(rightOnly.renderState().renderObserveCalls, 0);
  rightOnly.api.dispose();
});

test('v4 mixed recovery retains the eight-arm limit and owned pending cleanup', async () => {
  for (const end of ['drain', 'dispose', 'arm-failure', 'eight-arm-limit']) {
    const env = browserFixture({
      installerOptions: { policy: INTERACTION_EVENT_TIMING_PLAN_V4.policy },
      throwAt: end === 'arm-failure' ? 'render-observe' : null,
    });
    witness(env);
    if (end === 'eight-arm-limit') {
      for (let index = 0; index < 8; index++) {
        env.setNow(30 + index * 2);
        env.mutate(mixedMeasurementRecords(env));
        env.setNow(31 + index * 2);
        env.render();
      }
      env.setNow(50);
      env.mutate(mixedMeasurementRecords(env));
      assert.equal(env.api.read().overflow, true);
      assert.equal(env.api.read().actions[0].renderBoundaryArms, 8);
    } else {
      env.mutate(mixedMeasurementRecords(env));
      if (end === 'drain') {
        env.setNow(200);
        const drain = env.api.drain(1);
        env.setNow(1200);
        env.timers.get(1)();
        env.timers.delete(1);
        await drain;
        assert.equal(
          env.api.read().actions[0].renderBoundaryPendingAtDrainEnd,
          true,
        );
      } else if (end === 'dispose') env.api.dispose();
      else assert.equal(env.api.read().overflow, true);
    }
    assert.equal(env.renderState().renderObserved, false);
    env.api.dispose();
    assert.equal(env.listeners.size, 0);
    assert.equal(env.timers.size, 0);
  }
});

test('unsupported installer policy or extra options fail before acquiring observers or callbacks', () => {
  for (const installerOptions of [
    null,
    [],
    'v4',
    { policy: undefined },
    { policy: INTERACTION_EVENT_TIMING_PLAN_V2.policy },
    { policy: 'unknown' },
    { policy: INTERACTION_EVENT_TIMING_PLAN_V4.policy, skipGeometry: true },
  ]) {
    const env = browserFixture({ installerOptions });
    assert.match(env.initializationError?.message || '', /installer/);
    assert.equal(env.api, undefined);
    assert.equal(env.listeners.size, 0);
    assert.equal(env.timers.size, 0);
    assert.equal(env.renderState().renderObserveCalls, 0);
  }
});

test('a complete existing RO can reprove a mixed batch before its source-only arm, or a mixed coalesced batch', () => {
  for (const bracketed of [false, true]) {
    const { capture, samples } = mixedBoundaryFixture();
    if (bracketed) {
      const first = structuredClone(capture.observations[1]);
      first.atMs = 1048;
      first.mutation.callback = 1;
      capture.observations[0].mutation.callback = 2;
      capture.observations[1].mutation.callback = 3;
      capture.observations.unshift(first);
      capture.work.restoredMeasurementTransactions++;
      Object.assign(capture.actions[0].renderBoundaryProofs[0], {
        armedAtMs: 1049,
        armedByMutationCallback: 1,
        sourceMutationCallback: 3,
        observedThroughMutationCallback: 3,
      });
    }
    assert.throws(
      () => validateInteractionEventTiming(capture, samples),
      /post-layout/,
    );
    useFreshReproofPlan(capture);
    validateInteractionEventTiming(capture, samples);
  }
});

test('fresh RO and RAF checkpoints both renew unknown geometry, without renewing known contrary state', () => {
  const { capture, samples } = fixture();
  addBoundaryRecovery(capture);
  const proof = capture.actions[0].renderBoundaryProofs[0];
  capture.observations.push({
    atMs: 1052,
    kind: 'unproven-geometry',
    generation: 1,
    invalid: true,
    reason: 'window-resize',
  });
  useFreshReproofPlan(capture);
  validateInteractionEventTiming(capture, samples);
  for (const kind of ['contrary-intent', 'contrary-button-state']) {
    const contrary = structuredClone(capture);
    contrary.observations[1].kind = kind;
    assert.throws(
      () => validateInteractionEventTiming(contrary, samples),
      /contrary/,
    );
  }
  const freshRaf = structuredClone(capture);
  const second = freshRaf.actions[0].witnesses[1];
  Object.assign(second, { atMs: 1058, completedAtMs: 1059 });
  freshRaf.actions[0].renderBoundaryProofs[0].baseline.ordinal = 1;
  const rafSamples = structuredClone(samples);
  rafSamples[0].buttonFeedbackAtMs = 1058;
  validateInteractionEventTiming(freshRaf, rafSamples);
  // A completed current-state read cannot cover a mutation arriving during it.
  capture.observations[1].atMs = proof.atMs + 0.5;
  assert.throws(
    () => validateInteractionEventTiming(capture, samples),
    /does not cover/,
  );
});

test('fresh reproof keeps earliest-end, later-invalidation, identity and ownership guards', () => {
  for (const [name, corrupt] of [
    [
      'late-completion',
      (x) => {
        x.actions[0].renderBoundaryProofs[0].completedAtMs = 1061;
      },
    ],
    [
      'rounding-interval',
      (x) => {
        Object.assign(x.actions[0].renderBoundaryProofs[0], {
          atMs: 1062,
          completedAtMs: 1063,
        });
      },
    ],
    [
      'later-unknown',
      (x) => {
        x.observations.push({
          atMs: 1058,
          kind: 'unproven-geometry',
          generation: 1,
          invalid: true,
          reason: 'window-scroll',
        });
      },
    ],
    [
      'later-foreground',
      (x) => {
        x.observations.push({
          atMs: 1058,
          kind: 'foreground',
          visible: false,
          focused: false,
          invalid: true,
        });
      },
    ],
    [
      'epoch',
      (x) => {
        x.actions[0].renderBoundaryProofs[0].intentEpoch++;
      },
    ],
    [
      'desired-state',
      (x) => {
        x.actions[0].renderBoundaryProofs[0].expected = false;
      },
    ],
    [
      'generation',
      (x) => {
        x.actions[0].renderBoundaryProofs[0].generation++;
      },
    ],
    [
      'source-owner',
      (x) => {
        x.actions[0].renderBoundaryProofs[0].armedByMutationCallback = 1;
      },
    ],
    [
      'unowned-mixed-source',
      (x) => {
        Object.assign(x.actions[0].renderBoundaryProofs[0], {
          armedAtMs: 1051,
          armedByMutationCallback: 1,
        });
        x.observations[0].mutation.reasons[0].reason =
          'unrecognized-restoration';
      },
    ],
    [
      'observed-through',
      (x) => {
        const mixed = x.observations[0],
          pure = x.observations[1];
        mixed.atMs = 1052;
        mixed.mutation.callback = 2;
        pure.atMs = 1050;
        pure.mutation.callback = 1;
        Object.assign(x.actions[0].renderBoundaryProofs[0], {
          armedAtMs: 1051,
          armedByMutationCallback: 1,
          sourceMutationCallback: 1,
          observedThroughMutationCallback: 1,
        });
      },
    ],
  ]) {
    const { capture, samples } = mixedBoundaryFixture();
    useFreshReproofPlan(capture);
    corrupt(capture);
    assert.throws(
      () => validateInteractionEventTiming(capture, samples),
      undefined,
      name,
    );
  }
  const boundary = mixedBoundaryFixture();
  useFreshReproofPlan(boundary.capture);
  boundary.capture.actions[0].renderBoundaryProofs[0].completedAtMs = 1060;
  validateInteractionEventTiming(boundary.capture, boundary.samples);
  // A genuine mixed arm precedes the later pure callback that coalesces into it.
  Object.assign(boundary.capture.actions[0].renderBoundaryProofs[0], {
    armedAtMs: 1051,
    armedByMutationCallback: 1,
  });
  validateInteractionEventTiming(boundary.capture, boundary.samples);
});

test('a later RAF never substitutes for the timely post-layout obligation of a recognized measurement', () => {
  for (const absent of [true, false]) {
    const { capture, samples } = mixedBoundaryFixture();
    useFreshReproofPlan(capture);
    if (absent) {
      capture.actions[0].renderBoundaryProofs = [];
      capture.actions[0].renderBoundaryArms = 0;
      capture.work.renderBoundaryArms = 0;
      capture.work.renderBoundaryCallbacks = 0;
      capture.work.geometryChecks--;
    } else
      Object.assign(capture.actions[0].renderBoundaryProofs[0], {
        atMs: 1090,
        completedAtMs: 1091,
      });
    Object.assign(capture.actions[0].witnesses[1], {
      atMs: 1058,
      completedAtMs: 1059,
    });
    samples[0].buttonFeedbackAtMs = 1058;
    assert.throws(
      () => validateInteractionEventTiming(capture, samples),
      /eligible post-layout proof/,
    );
  }
});

test('serialized observer negatives for changed node, state, ancestry or scroll remain sticky before a later positive RAF', () => {
  for (const mode of [
    'detached',
    'replaced',
    'hidden',
    'clipped',
    'intent',
    'state',
    'moved',
    'scrolled',
  ]) {
    const env = browserFixture();
    witness(env);
    env.mutate(measurementRecords(env));
    if (mode === 'detached') env.button.isConnected = false;
    if (mode === 'replaced') env.document.querySelector = () => ({});
    if (mode === 'hidden') env.ancestor.style.opacity = '0';
    if (mode === 'clipped') {
      env.ancestor.style.overflowY = 'hidden';
      env.ancestor.rect.bottom = 0;
    }
    if (mode === 'intent')
      env.window.__godsEyeView.dataManager.layers.get('local-datacenters')
        .visibilityIntentEpoch++;
    if (mode === 'state') env.button.attributes.class = 'data-toggle-btn';
    if (mode === 'moved') {
      env.button.rect.top++;
      env.button.rect.bottom++;
    }
    if (mode === 'scrolled') env.ancestor.scrollTop = 260;
    env.setNow(40);
    env.render();
    const negative = structuredClone(
      env.api.read().actions[0].renderBoundaryProofs[0],
    );
    assert.ok(!negative.visible || !negative.restoredGeometry, mode);
    env.button.isConnected = true;
    env.document.querySelector = () => env.button;
    env.ancestor.style.opacity = '1';
    env.ancestor.style.overflowY = 'visible';
    env.ancestor.rect.bottom = 100;
    env.ancestor.scrollTop = 0;
    env.button.rect.top = 5;
    env.button.rect.bottom = 25;
    env.window.__godsEyeView.dataManager.layers.get(
      'local-datacenters',
    ).visibilityIntentEpoch = 1;
    env.button.attributes.class = 'data-toggle-btn transitioning enabling';
    env.setNow(50);
    env.api.witness(
      { generation: 1, acceptedIntentEpoch: 1, expected: true },
      48,
      'transition',
      50,
    );
    assert.equal(env.api.read().actions[0].witnesses[1].visible, true);
    env.api.dispose();
    const { capture, samples } = mixedBoundaryFixture();
    useFreshReproofPlan(capture);
    const recovery = capture.actions[0].renderBoundaryProofs[0];
    for (const key of ['visible', 'focused', 'geometry', 'restoredGeometry'])
      recovery[key] = negative[key];
    recovery.baseline.ordinal = 1;
    Object.assign(capture.actions[0].witnesses[1], {
      atMs: 1058,
      completedAtMs: 1059,
    });
    samples[0].buttonFeedbackAtMs = 1058;
    // A later positive RO fulfills every measurement obligation. The earlier
    // real negative must still reject, independently of those obligations.
    const later = structuredClone(capture.observations[1]);
    later.atMs = 1064;
    later.mutation.callback = 3;
    capture.observations.push(later);
    capture.work.restoredMeasurementTransactions++;
    capture.work.renderBoundaryArms++;
    capture.work.renderBoundaryCallbacks++;
    capture.work.geometryChecks++;
    capture.work.continuityChecks++;
    capture.actions[0].renderBoundaryArms++;
    capture.actions[0].renderBoundaryProofs.push({
      ...recovery,
      ordinal: 2,
      armedAtMs: 1065,
      armedByMutationCallback: 3,
      sourceMutationCallback: 3,
      observedThroughMutationCallback: 3,
      baseline: { kind: 'raf', ordinal: 2 },
      atMs: 1070,
      completedAtMs: 1071,
      visible: true,
      focused: true,
      geometry: geometryFixture(),
      restoredGeometry: true,
    });
    capture.entries[0].duration = 96;
    capture.entries[0].deliveredAtMs = 1100;
    assert.throws(
      () => validateInteractionEventTiming(capture, samples),
      /contradicts visible feedback/,
      mode,
    );
  }
});

test('owned post-layout observer coalesces batches, drains pending mutations and detects persistent geometry changes', () => {
  for (const mode of [
    'unchanged',
    'moved',
    'scrolled',
    'hidden',
    'intent',
    'pending-unknown',
  ]) {
    const env = browserFixture();
    witness(env);
    env.mutate(measurementRecords(env));
    env.setNow(35);
    env.mutate(measurementRecords(env));
    assert.equal(env.renderState().renderObserveCalls, 1);
    if (mode === 'moved') {
      env.button.rect.top += 5;
      env.button.rect.bottom += 5;
    }
    if (mode === 'scrolled') env.ancestor.scrollTop = 260;
    if (mode === 'hidden') env.ancestor.style.opacity = '0';
    if (mode === 'intent')
      env.window.__godsEyeView.dataManager.layers.get('local-datacenters')
        .visibilityIntentEpoch++;
    if (mode === 'pending-unknown')
      env.queueMutations([
        {
          type: 'attributes',
          target: env.ancestor,
          attributeName: 'style',
          oldValue: 'opacity: 0;',
        },
      ]);
    env.setNow(40);
    env.render();
    const capture = env.api.read(),
      proof = capture.actions[0].renderBoundaryProofs[0];
    assert.equal(proof.sourceMutationCallback, 2);
    assert.equal(capture.work.renderBoundaryArms, 1);
    assert.equal(capture.work.renderBoundaryCallbacks, 1);
    assert.equal(capture.work.geometryChecks, 2);
    if (['hidden', 'intent'].includes(mode)) assert.equal(proof.visible, false);
    if (['moved', 'scrolled'].includes(mode))
      assert.equal(proof.restoredGeometry, false);
    if (mode === 'unchanged') assert.equal(proof.restoredGeometry, true);
    if (mode === 'pending-unknown') {
      assert.equal(capture.observations.length, 3);
      assert.equal(capture.observations.at(-1).mutation.callback, 3);
      assert.equal(proof.observedThroughMutationCallback, 3);
    }
    assert.equal(env.renderState().renderObserved, false);
    env.api.dispose();
  }
});

test('post-layout arms are bounded and release pending targets on drain expiry, overflow, failure and disposal', async () => {
  for (const end of ['drain', 'overflow', 'dispose', 'arm-failure']) {
    const env = browserFixture({
      throwAt: end === 'arm-failure' ? 'render-observe' : null,
    });
    witness(env);
    env.mutate(measurementRecords(env));
    if (end === 'drain') {
      env.setNow(200);
      const drain = env.api.drain(1);
      env.setNow(1200);
      env.timers.get(1)();
      env.timers.delete(1);
      await drain;
      assert.equal(
        env.api.read().actions[0].renderBoundaryPendingAtDrainEnd,
        true,
      );
    } else if (end === 'overflow') {
      env.mutate(Array(65537).fill({}));
      assert.equal(env.api.read().overflow, true);
    } else if (end === 'dispose') env.api.dispose();
    else assert.equal(env.api.read().overflow, true);
    assert.equal(env.renderState().renderObserved, false);
    env.api.dispose();
  }
  const bounded = browserFixture();
  witness(bounded);
  for (let index = 0; index < 8; index++) {
    bounded.setNow(30 + index * 2);
    bounded.mutate(measurementRecords(bounded));
    bounded.setNow(31 + index * 2);
    bounded.render();
  }
  bounded.setNow(50);
  bounded.mutate(measurementRecords(bounded));
  assert.equal(bounded.api.read().overflow, true);
  assert.equal(bounded.api.read().work.renderBoundaryArms, 8);
  assert.equal(bounded.renderState().renderObserved, false);
  bounded.api.dispose();
  const failed = browserFixture({ throwAt: 'render-constructor' });
  assert.match(failed.initializationError.message, /controlled/);
  assert.equal(failed.api, undefined);
  assert.equal(failed.listeners.size, 0);
});

test('measurement recognition remains bound to synchronous source and non-animated allocation CSS', () => {
  const source = readFileSync(
    new URL('../../src/ui/leftPanelRail.js', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /setAttribute\('data-rail-measuring', ''\);\s*try \{[\s\S]*?finally \{\s*stack.removeAttribute\('data-rail-measuring'\)/,
  );
  const layers = readFileSync(
    new URL('../../src/ui/styles/layers.css', import.meta.url),
    'utf8',
  );
  const marker = [
    ...layers.matchAll(
      /#left-panel-stack\[data-rail-measuring\][^{]*\{([^}]*)\}/g,
    ),
  ];
  assert.equal(marker.length, 1);
  assert.equal(
    marker[0][1].trim(),
    '--left-panel-allocated-height: initial !important;',
  );
  for (const file of ['layers.css', 'panel-surfaces.css', 'scenes.css']) {
    const css = readFileSync(
      new URL('../../src/ui/styles/' + file, import.meta.url),
      'utf8',
    );
    for (const match of css.matchAll(
      /([\w-]+)\s*:\s*([^;{}]*var\(--left-panel-allocated-height[^;{}]*);/g,
    ))
      assert.ok(['flex', 'height', 'max-height'].includes(match[1]), match[0]);
  }
  const dataPanel = layers.match(/\n#data-panel \{([^}]*)\}/)[1];
  const transition = dataPanel.match(/transition\s*:\s*([^;]+);/)[1];
  assert.deepEqual(
    transition.split(',').map((x) => x.trim().split(/\s+/)[0]),
    ['opacity', 'visibility', 'transform'],
  );
  for (const file of ['cctv.css', 'scenes.css']) {
    const css = readFileSync(
      new URL('../../src/ui/styles/' + file, import.meta.url),
      'utf8',
    );
    const body = css.match(
      new RegExp(
        '#' +
          (file === 'cctv.css' ? 'cctv-panel' : 'scene-panel') +
          ' \\{([^}]*)\\}',
      ),
    )[1];
    assert.doesNotMatch(body, /(?:animation|transition)\s*:/);
  }
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
