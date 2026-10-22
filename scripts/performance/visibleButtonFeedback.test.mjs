import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import {
  installInteractionObserverInPage,
  QUALIFICATION_REPLAY_FIXTURE_CONTRACT,
} from '../qa-qualification-metrics-capture.mjs';

function harness(installSource) {
  let now = 100,
    state = 'off',
    active = false,
    enabled = false;
  let lod = { computed: false, total: 0, active: 0 };
  let visible = true;
  const frames = new Map(),
    sceneListeners = new Map(),
    input = new Map();
  let frameId = 0;
  const button = {
    disabled: false,
    dataset: {
      get feedState() {
        return state;
      },
    },
    get textContent() {
      return state.toUpperCase();
    },
    classList: {
      contains(name) {
        return name === 'active'
          ? active
          : name === 'transitioning'
            ? ['enabling', 'disabling'].includes(state)
            : name === state;
      },
    },
    getAttribute(name) {
      return ['aria-busy', 'aria-disabled'].includes(name)
        ? String(['enabling', 'disabling'].includes(state))
        : null;
    },
    getBoundingClientRect: () => ({
      left: 1,
      top: 1,
      right: 30,
      bottom: 30,
      width: 29,
      height: 29,
    }),
    addEventListener(name, listener) {
      input.set(name, listener);
    },
    removeEventListener(name) {
      input.delete(name);
    },
    contains: (target) => target === button,
  };
  const slider = { addEventListener() {}, removeEventListener() {} };
  const entry = {
    visibilityIntentEpoch: 0,
    visibilityIntentEnabled: false,
    module: { getLodDiagnostics: () => lod },
  };
  const scene = {
    frameState: { frameNumber: 10 },
    preRender: {
      addEventListener(callback) {
        sceneListeners.set('pre', callback);
        return () => sceneListeners.delete('pre');
      },
    },
    postRender: {
      addEventListener(callback) {
        sceneListeners.set('post', callback);
        return () => sceneListeners.delete('post');
      },
    },
  };
  const sandbox = {
    performance: { now: () => now },
    requestAnimationFrame: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setInterval: () => 1,
    clearInterval() {},
    document: {
      get visibilityState() {
        return visible ? 'visible' : 'hidden';
      },
      hasFocus: () => visible,
      querySelector: (selector) =>
        selector.includes('local-datacenters') ? button : slider,
    },
    window: {
      innerWidth: 800,
      innerHeight: 600,
      getComputedStyle: () => ({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
      }),
      __godsEyeView: {
        viewer: { scene },
        dataManager: {
          layers: new Map([['local-datacenters', entry]]),
          isEnabled: () => enabled,
          subscribe: () => () => {},
          subscribeVisibilityRequests: () => () => {},
        },
      },
    },
    console,
  };
  runInNewContext(
    `(${installSource})`,
    sandbox,
  )(QUALIFICATION_REPLAY_FIXTURE_CONTRACT);
  const observer = sandbox.window.__qualificationMetricsObserver;
  return {
    observer,
    entry,
    arm() {
      observer.arm('localControl', true);
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        now++;
        input.get(type)({
          type,
          isTrusted: true,
          timeStamp: now,
          currentTarget: button,
          target: button,
        });
      }
      entry.visibilityIntentEpoch = 1;
      entry.visibilityIntentEnabled = true;
      observer.onVisibilityRequest({
        type: 'visibility-requested',
        layerId: 'local-datacenters',
        enabled: true,
        origin: 'user',
        intentEpoch: 1,
      });
      state = 'enabling';
      observer.onVisibilityTransition({
        type: 'visibility-transition',
        layerId: 'local-datacenters',
        enabled: true,
        origin: 'user',
        intentEpoch: 1,
      });
    },
    frame(timestamp, callbackAt = timestamp) {
      now = callbackAt;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(timestamp);
    },
    settleButton() {
      state = 'on';
      active = true;
      enabled = true;
    },
    setVisible(value) {
      visible = value;
    },
    complete() {
      now = 300;
      lod = { computed: true, total: 8, active: 8 };
      scene.frameState.frameNumber++;
      sceneListeners.get('pre')();
      sceneListeners.get('post')();
    },
  };
}
const correctedSource = installInteractionObserverInPage.toString();

test('minimal correction retains both visible phases of the same accepted intent', () => {
  const page = harness(correctedSource);
  page.arm();
  page.frame(120);
  page.settleButton();
  page.frame(136);
  assert.equal(page.observer.pending.buttonFeedbackAtMs, 136);
  assert.equal(page.observer.pending.buttonFeedbackFirstFrameAtMs, 120);
  assert.equal(page.observer.pending.buttonFeedbackFirstState, 'transition');
  assert.equal(page.observer.pending.buttonFeedbackState, 'settled');
  assert.equal(
    page.observer.pending.stateAtMs,
    null,
    'Feedback cannot claim full LOD readiness',
  );
  assert.equal(page.observer.records.length, 0);
  page.complete();
  const record = page.observer.take();
  assert.equal(record.stateAtMs, 300);
  assert.equal(record.renderedFrameAtMs, 300);
  assert.equal(record.buttonFeedbackAtMs, 136);
  page.observer.dispose();
});
test('correction retains distinct-frame, visibility and accepted-intent guards', () => {
  for (const invalidate of [
    (page) => page.setVisible(false),
    (page) => {
      page.entry.visibilityIntentEpoch = 2;
    },
  ]) {
    const page = harness(correctedSource);
    page.arm();
    page.frame(120);
    invalidate(page);
    page.frame(136);
    assert.equal(page.observer.pending.buttonFeedbackAtMs, null);
    assert.equal(page.observer.pending.buttonFeedbackConsecutiveFrames, 0);
    page.observer.dispose();
  }
  const page = harness(correctedSource);
  page.arm();
  page.frame(120);
  page.settleButton();
  page.frame(120, 136);
  assert.equal(
    page.observer.pending.buttonFeedbackAtMs,
    null,
    'A repeated timestamp cannot supply a second frame',
  );
  assert.equal(page.observer.pending.buttonFeedbackFirstState, 'settled');
  page.frame(152);
  assert.equal(page.observer.pending.buttonFeedbackAtMs, 152);
  page.observer.dispose();
});
