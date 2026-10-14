import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  DEFAULT_FOCUS_DEEMPHASIS_PARAMS,
  advanceFocusEvidenceNowMs,
  advanceProjectedSpriteFocus,
  advanceSpriteFocus,
  clearFocusTarget,
  focusNowMs,
  focusAlphaNeedsWrite,
  focusTargetEmphasis,
  nearFarScalarValueAtDistance,
  onFocusTargetChange,
  publishFocusTargetFromCachedPosition,
  setFocusEvidenceNowMs,
  smoothFocusEmphasis,
} from './focusDeemphasis.js';

const params = { ...DEFAULT_FOCUS_DEEMPHASIS_PARAMS, paddingPx: 0 };
const target = {
  screenRect: { left: 40, top: 40, right: 60, bottom: 60 },
  paddingPx: 0,
  cameraDistance: 1000,
};

test('focus identity changes notify once and isolate listener failures', () => {
  const originalProject = Cesium.SceneTransforms.worldToWindowCoordinates;
  const originalWarn = console.warn;
  Cesium.SceneTransforms.worldToWindowCoordinates = () =>
    new Cesium.Cartesian2(10, 20);
  console.warn = () => {};
  clearFocusTarget();
  const changes = [];
  const removeFailureListener = onFocusTargetChange(() => {
    throw new Error('observer failure');
  });
  const remove = onFocusTargetChange((next, previous) => {
    changes.push({ next: next?.id ?? null, previous: previous?.id ?? null });
  });
  const camera = { positionWC: new Cesium.Cartesian3(0, 0, 0) };
  const publish = (ownerLayer, id, frameNumber) =>
    publishFocusTargetFromCachedPosition({
      ownerLayer,
      id,
      scene: { frameState: { frameNumber } },
      camera,
      displayPosition: new Cesium.Cartesian3(1, 2, 3),
    });

  try {
    publish('flights', 'A', 1);
    publish('flights', 'A', 2);
    publish('flights', 'B', 3);
    publish('satellites', 'B', 4);
    clearFocusTarget('flights', 'B');
    clearFocusTarget('satellites', 'B');
    remove();
    publish('flights', 'C', 5);
    assert.deepEqual(changes, [
      { next: 'A', previous: null },
      { next: 'B', previous: 'A' },
      { next: 'B', previous: 'B' },
      { next: null, previous: 'B' },
    ]);
  } finally {
    remove();
    removeFailureListener();
    clearFocusTarget();
    Cesium.SceneTransforms.worldToWindowCoordinates = originalProject;
    console.warn = originalWarn;
  }
});

test('focus decision dims a farther sprite inside and preserves one outside', () => {
  assert.equal(focusTargetEmphasis({ x: 50, y: 50 }, 1200, target, params), 0.25);
  assert.equal(focusTargetEmphasis({ x: 61, y: 50 }, 1200, target, params), 1);
});

test('focus decision keeps nearer behavior tunable across allow, dim, and partial', () => {
  assert.equal(focusTargetEmphasis({ x: 50, y: 50 }, 800, target, { ...params, nearerBehavior: 'allow' }), 1);
  assert.equal(focusTargetEmphasis({ x: 50, y: 50 }, 800, target, { ...params, nearerBehavior: 'dim' }), 0.25);
  assert.equal(focusTargetEmphasis({ x: 50, y: 50 }, 800, target, { ...params, nearerBehavior: 'partial' }), 0.625);
});

test('focus decision applies padding and hysteresis at the boundary', () => {
  assert.equal(focusTargetEmphasis({ x: 64, y: 50 }, 1200, target, { ...params, paddingPx: 3 }), 1);
  assert.equal(focusTargetEmphasis({ x: 63, y: 50 }, 1200, target, { ...params, paddingPx: 3 }), 0.25);
  assert.equal(focusTargetEmphasis({ x: 65, y: 50 }, 1200, target, { ...params, hysteresisPx: 6 }, false), 1);
  assert.equal(focusTargetEmphasis({ x: 65, y: 50 }, 1200, target, { ...params, hysteresisPx: 6 }, true), 0.25);
});

test('focus overlap includes the ambient sprite own rendered extent', () => {
  assert.equal(focusTargetEmphasis({ x: 68, y: 50 }, 1200, target, params, false, 8, 8), 0.25);
  assert.equal(focusTargetEmphasis({ x: 68, y: 50 }, 1200, target, params, false, 2, 2), 1);
});

test('focus decision never falls below the configured floor', () => {
  assert.equal(focusTargetEmphasis({ x: 50, y: 50 }, 1200, target, { ...params, dimFloor: 0.41 }), 0.41);
  assert.equal(focusTargetEmphasis({ x: 50, y: 50 }, 1200, target, { ...params, dimFloor: 0 }), 0.01);
});

test('smoothing converges over configured attack and release instead of snapping', () => {
  const attackMid = smoothFocusEmphasis(1, 0.25, 150, params);
  assert.ok(attackMid < 1 && attackMid > 0.25, `attack midpoint=${attackMid}`);
  assert.equal(smoothFocusEmphasis(1, 0.25, 300, params), 0.25);
  const releaseMid = smoothFocusEmphasis(0.25, 1, 300, params);
  assert.ok(releaseMid > 0.25 && releaseMid < 1, `release midpoint=${releaseMid}`);
  assert.equal(smoothFocusEmphasis(0.25, 1, 600, params), 1);
});

test('default attack yields at least four distinct 80 ms sampled values', () => {
  const samples = [0, 80, 160, 240, 320]
    .map((elapsedMs) => smoothFocusEmphasis(1, 0.25, elapsedMs, params));
  assert.ok(new Set(samples.slice(1)).size >= 4, `samples=${samples.join(',')}`);
  assert.equal(samples.at(-1), 0.25);
});

test('per-sprite state attacks, restores after focus clears, and settles at one', () => {
  const sprite = {};
  const input = { screenPosition: { x: 50, y: 50 }, cameraDistance: 1200, target, params };
  assert.equal(advanceSpriteFocus(sprite, { ...input, nowMs: 0 }).factor, 1);
  const attack = advanceSpriteFocus(sprite, { ...input, nowMs: 150 });
  assert.ok(attack.factor < 1 && attack.factor > 0.25);
  assert.equal(advanceSpriteFocus(sprite, { ...input, nowMs: 300 }).factor, 0.25);
  assert.equal(advanceSpriteFocus(sprite, { ...input, target: null, nowMs: 300 }).factor, 0.25);
  const release = advanceSpriteFocus(sprite, { ...input, target: null, nowMs: 600 });
  assert.ok(release.factor > 0.25 && release.factor < 1);
  assert.equal(advanceSpriteFocus(sprite, { ...input, target: null, nowMs: 900 }).factor, 1);
});

test('release crosses the write deadband, writes exact identity, then suspends', () => {
  const releaseTimes = [4826.2, 4910.9, 5002, 5123.9, 5317.9];
  for (const baseAlpha of [1, 0.7]) {
    const sprite = {};
    let currentAlpha = baseAlpha;
    const sample = (nowMs, targetState) => {
      const focus = advanceSpriteFocus(sprite, {
        screenPosition: { x: 50, y: 50 },
        cameraDistance: 1200,
        target: targetState,
        nowMs,
      });
      const nextAlpha = baseAlpha * focus.factor;
      const shouldWrite = focusAlphaNeedsWrite(currentAlpha, nextAlpha, null, focus.endpointCompleted);
      if (shouldWrite) currentAlpha = nextAlpha;
      return { focus, nextAlpha, shouldWrite };
    };

    for (const nowMs of [3984, 4095.8, 4197.9, 4299.7, 4397.9, 4534.8, 4615.4, 4730.5])
      sample(nowMs, target);

    let release;
    for (const nowMs of releaseTimes) release = sample(nowMs, null);
    assert.equal(release.focus.active, true);
    assert.equal(release.focus.transitioning, true);
    assert.ok(currentAlpha < baseAlpha);

    const nearEndpoint = sample(5398, null);
    assert.ok(nearEndpoint.nextAlpha - currentAlpha <= DEFAULT_FOCUS_DEEMPHASIS_PARAMS.writeEpsilon);
    assert.equal(nearEndpoint.shouldWrite, false);
    assert.equal(nearEndpoint.focus.active, true);

    const endpoint = sample(5478, null);
    assert.equal(endpoint.focus.factor, 1);
    assert.equal(endpoint.focus.endpointCompleted, true);
    assert.equal(endpoint.focus.active, false);
    assert.equal(endpoint.shouldWrite, true);
    assert.equal(currentAlpha, baseAlpha);

    const unrelated = advanceProjectedSpriteFocus({}, null, null, null, 5479, null);
    assert.equal(unrelated.endpointCompleted, false, 'projected fast path clears the shared result flag');

    const settled = sample(5558, null);
    assert.equal(settled.focus.active, false);
    assert.equal(settled.focus.endpointCompleted, false);
    assert.equal(settled.shouldWrite, false);
  }
});

test('attack endpoint also bypasses alpha deadband for a composed base color', () => {
  const sprite = {};
  const baseAlpha = 0.7;
  let currentAlpha = baseAlpha;
  const sample = (nowMs) => {
    const focus = advanceSpriteFocus(sprite, {
      screenPosition: { x: 50, y: 50 },
      cameraDistance: 1200,
      target,
      nowMs,
    });
    const nextAlpha = baseAlpha * focus.factor;
    const shouldWrite = focusAlphaNeedsWrite(currentAlpha, nextAlpha, null, focus.endpointCompleted);
    if (shouldWrite) currentAlpha = nextAlpha;
    return { focus, nextAlpha, shouldWrite };
  };

  for (const nowMs of [0, 80, 160, 240, 280]) sample(nowMs);
  const nearFloor = sample(290);
  assert.ok(nearFloor.nextAlpha - currentAlpha <= DEFAULT_FOCUS_DEEMPHASIS_PARAMS.writeEpsilon);
  assert.equal(nearFloor.shouldWrite, false);
  assert.equal(nearFloor.focus.endpointCompleted, false);

  const endpoint = sample(300);
  assert.equal(endpoint.focus.factor, DEFAULT_FOCUS_DEEMPHASIS_PARAMS.dimFloor);
  assert.equal(endpoint.focus.endpointCompleted, true);
  assert.equal(endpoint.shouldWrite, true);
  assert.equal(currentAlpha, baseAlpha * DEFAULT_FOCUS_DEEMPHASIS_PARAMS.dimFloor);
});

test('distance chatter reanchors from current progress and converges toward the majority state', () => {
  const sprite = {};
  const chatterParams = { ...params, nearerBehavior: 'allow', distanceHysteresisRatio: 0.08 };
  const distances = [1200, 990, 1010, 995, 1005, 990, 1200, 990, 1010];
  const factors = distances.map((cameraDistance, index) => advanceSpriteFocus(sprite, {
    screenPosition: { x: 50, y: 50 },
    cameraDistance,
    target,
    params: chatterParams,
    nowMs: index * 80,
  }).factor);
  for (let index = 1; index < factors.length; index += 1) {
    assert.ok(factors[index] <= factors[index - 1] + 1e-12, `factors=${factors.join(',')}`);
  }
  assert.ok(factors.at(-1) < 0.5, `factors=${factors.join(',')}`);

  const dimSprite = {};
  const dimFactors = [0, 80, 160, 240].map((nowMs, index) => advanceSpriteFocus(dimSprite, {
    screenPosition: { x: 50, y: 50 },
    cameraDistance: index % 2 ? 990 : 1010,
    target,
    params: { ...params, nearerBehavior: 'dim' },
    nowMs,
  }).factor);
  assert.ok(dimFactors.at(-1) < 1, `dimFactors=${dimFactors.join(',')}`);
});

test('alternating desired state reanchors from sampled progress and converges to a stable cycle', () => {
  const sprite = {};
  const chatterParams = { ...params, nearerBehavior: 'allow', distanceHysteresisRatio: 0.08 };
  const factors = Array.from({ length: 20 }, (_, index) => advanceSpriteFocus(sprite, {
    screenPosition: { x: 50, y: 50 },
    // Cross both sides of the range hysteresis band every tick so `desired`
    // truly alternates instead of latching in the prior state.
    cameraDistance: index % 2 === 0 ? 1200 : 800,
    target,
    params: chatterParams,
    nowMs: index * 80,
  }).factor);

  assert.ok(new Set(factors).size >= 16, `factors=${factors.join(',')}`);
  const earlyEvenDelta = Math.abs(factors[4] - factors[2]);
  const lateEvenDelta = Math.abs(factors[18] - factors[16]);
  const earlyOddDelta = Math.abs(factors[5] - factors[3]);
  const lateOddDelta = Math.abs(factors[19] - factors[17]);
  assert.ok(lateEvenDelta < earlyEvenDelta, `even factors=${factors.join(',')}`);
  assert.ok(lateOddDelta < earlyOddDelta, `odd factors=${factors.join(',')}`);
});

test('advanceSpriteFocus returns its documented module singleton', () => {
  const sprite = {};
  const input = { screenPosition: { x: 50, y: 50 }, cameraDistance: 1200, target, params };
  const first = advanceSpriteFocus(sprite, { ...input, nowMs: 0 });
  const second = advanceSpriteFocus(sprite, { ...input, nowMs: params.attackMs });
  assert.strictEqual(first, second);
  assert.equal(first.factor, params.dimFloor, 'the prior reference reflects the next call');
});

test('evidence clock produces identical alpha sequences across repeated captures', () => {
  const sequenceOffsets = [0, 80, 160, 240, 320, 400, 560, 720, 880, 1040];
  const capture = (productionClockBase, productionClockStep) => {
    setFocusEvidenceNowMs(10_000);
    const sprite = {};
    const sequence = sequenceOffsets.map((offset, index) => {
      if (index > 0) advanceFocusEvidenceNowMs(offset - sequenceOffsets[index - 1]);
      const nowMs = focusNowMs(productionClockBase + index * productionClockStep);
      return advanceSpriteFocus(sprite, {
        screenPosition: { x: 50, y: 50 },
        cameraDistance: 1200,
        target: offset <= 320 ? target : null,
        params,
        nowMs,
      }).factor;
    });
    setFocusEvidenceNowMs(null);
    return sequence;
  };
  assert.deepEqual(capture(1_000, 1), capture(1_000_000, 9_999));
});

test('NearFarScalar rendered-size interpolation matches Cesium clamp endpoints', () => {
  const scalar = { near: 1000, nearValue: 3, far: 8_000_000, farValue: 0.5 };
  assert.equal(nearFarScalarValueAtDistance(scalar, 500), 3);
  assert.equal(nearFarScalarValueAtDistance(scalar, 9_000_000), 0.5);
  const middle = nearFarScalarValueAtDistance(scalar, 1_000_000);
  assert.ok(middle > 0.5 && middle < 3);
});
