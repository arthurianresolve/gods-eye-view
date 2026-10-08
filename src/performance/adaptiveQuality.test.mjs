import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQualityPolicy } from './adaptiveQuality.js';

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
