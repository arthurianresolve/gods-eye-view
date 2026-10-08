import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdaptiveQualityController,
  AdaptiveQualityPolicy,
} from './adaptiveQuality.js';

function feedWindow(policy, duration, start, density = 50) {
  let result = null;
  for (let i = 0; i < policy.windowSize; i += 1)
    result = policy.observe(duration, start + i, density) || result;
  return result;
}

test('adaptive policy lowers density only after sustained slow windows', () => {
  const policy = new AdaptiveQualityPolicy({
    windowSize: 4,
    slowWindows: 2,
    cooldownMs: 0,
  });
  assert.equal(feedWindow(policy, 30, 1000), null);
  assert.deepEqual(feedWindow(policy, 31, 2000), {
    densityPct: 25,
    p95FrameMs: 31,
    reason: 'frame-time-high',
  });
});

test('adaptive policy requires more headroom windows before raising quality', () => {
  const policy = new AdaptiveQualityPolicy({
    windowSize: 3,
    fastWindows: 3,
    cooldownMs: 0,
  });
  assert.equal(feedWindow(policy, 16, 1000), null);
  assert.equal(feedWindow(policy, 16, 2000), null);
  assert.equal(feedWindow(policy, 16, 3000).densityPct, 75);
});

test('adaptive policy respects hysteresis, cooldown, density limits and bad samples', () => {
  const policy = new AdaptiveQualityPolicy({
    windowSize: 2,
    slowWindows: 1,
    cooldownMs: 10_000,
  });
  assert.equal(policy.observe(500, 0, 50), null);
  assert.equal(feedWindow(policy, 30, 1).densityPct, 25);
  assert.equal(feedWindow(policy, 30, 100, 25), null);
  assert.equal(feedWindow(policy, 30, 20_000, 0), null);
  const bounded = new AdaptiveQualityPolicy({
    windowSize: 2,
    fastWindows: 1,
    cooldownMs: 0,
  });
  assert.equal(feedWindow(bounded, 12, 1, 100), null);
});

function controllerFixture(initialDensity = 50) {
  const listeners = new Map();
  const documentRef = {
    hidden: false,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    dispatch(type) {
      listeners.get(type)?.();
    },
  };
  let frame;
  const viewer = {
    scene: {
      postRender: {
        addEventListener(listener) {
          frame = listener;
          return () => {
            frame = null;
          };
        },
      },
    },
  };
  let density = initialDensity;
  let time = 0;
  const applied = [];
  const controller = new AdaptiveQualityController({
    viewer,
    documentRef,
    readDensity: () => density,
    applyDensity(value, reason) {
      density = value;
      applied.push({ value, reason });
    },
    storage: { getItem: () => null, setItem() {} },
    now: () => time,
  });
  return {
    applied,
    controller,
    documentRef,
    get density() {
      return density;
    },
    frame: (nextTime) => {
      time = nextTime;
      frame?.();
    },
    listeners,
  };
}

test('quality presets restore the remembered manual density and accept explicit overrides', () => {
  const f = controllerFixture(50);
  f.controller.setMode('quality', { persist: false });
  assert.equal(f.density, 75);
  f.controller.setMode('performance', { persist: false });
  assert.equal(f.density, 25);
  f.controller.setMode('manual', { persist: false });
  assert.equal(f.density, 50);

  f.controller.setMode('performance', { persist: false });
  f.controller.rememberManualDensity(75);
  f.controller.setMode('manual', { persist: false });
  assert.equal(f.density, 75);
  f.controller.destroy();
  assert.equal(f.listeners.size, 0);
});

test('Auto releases its frame listener and restores manual density when disabled', () => {
  const f = controllerFixture(50);
  f.controller.setMode('auto', { persist: false });
  f.frame(0);
  for (let time = 30; time <= 2_700; time += 30) f.frame(time);
  assert.equal(f.density, 25);
  f.controller.setMode('manual', { persist: false });
  assert.equal(f.density, 50);
  assert.ok(f.applied.some(({ reason }) => reason === 'auto-profile'));
  assert.equal(f.controller.policy.samples.length, 0);
  f.controller.destroy();
});

test('hidden tabs suspend Auto samples and reset elapsed frame timing', () => {
  const f = controllerFixture();
  f.controller.setMode('auto', { persist: false });
  f.frame(10);
  f.frame(26);
  assert.equal(f.controller.policy.samples.length, 1);
  f.documentRef.hidden = true;
  f.documentRef.dispatch('visibilitychange');
  assert.equal(f.controller.policy.samples.length, 0);
  f.frame(50_000);
  assert.equal(f.controller.policy.samples.length, 0);
  f.documentRef.hidden = false;
  f.documentRef.dispatch('visibilitychange');
  f.frame(50_016);
  assert.equal(f.controller.policy.samples.length, 0);
  f.frame(50_032);
  assert.equal(f.controller.policy.samples.length, 1);
  f.controller.destroy();
});
