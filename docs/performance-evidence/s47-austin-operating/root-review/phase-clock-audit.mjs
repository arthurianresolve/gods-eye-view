import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import { installPhasedMonotonicWallClock } from '../../../../scripts/performance/productionFlightFixture.mjs';
import { createRendering } from '../../../../src/layers/satellites/rendering.js';

const root = new URL('../../../../', import.meta.url);
const sourceNames = [
  'scripts/performance/productionFlightFixture.mjs',
  'src/layers/satellites/rendering.js',
];
const hashes = () =>
  Object.fromEntries(
    sourceNames.map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL(name, root)))
        .digest('hex'),
    ]),
  );
const beforeHashes = hashes();
const NativeDate = Date;
const fixed = Date.parse('2026-10-12T18:00:00.000Z');
const checks = [];
function record(id, action) {
  action();
  checks.push({ id, pass: true });
}
function fresh() {
  let mono = 5000;
  const nativeNow = () => mono;
  const target = { Date: NativeDate, performance: { now: nativeNow } };
  installPhasedMonotonicWallClock(fixed, 30000, 60000, target);
  return {
    target,
    nativeNow,
    clock: target.__gevPhasedMonotonicWallClockV1,
    advance: (ms) => {
      mono += ms;
    },
  };
}
const run = fresh();
const snapshots = [];
record('ten-runs-phase-order-monotonicity-and-independent-native-time', () => {
  for (let ordinal = 1; ordinal <= 10; ordinal++) {
    assert.equal(run.target.Date.now(), fixed);
    assert.equal(run.clock.snapshot().runOrdinal, ordinal);
    assert.throws(() => run.clock.resetForNextRun(ordinal), /completed run/);
    run.clock.startWarmup(ordinal);
    assert.throws(() => run.clock.resetForNextRun(ordinal), /completed run/);
    assert.throws(
      () => run.clock.startMeasurement(ordinal),
      /held warmup boundary/,
    );
    const epochs = [run.target.Date.now()];
    for (let second = 1; second <= 30; second++) {
      run.advance(1000);
      epochs.push(run.target.Date.now());
    }
    run.clock.holdWarmupBoundary(ordinal);
    run.advance(777);
    assert.equal(run.target.Date.now(), fixed + 30000);
    assert.throws(() => run.clock.resetForNextRun(ordinal), /completed run/);
    run.clock.startMeasurement(ordinal);
    assert.throws(() => run.clock.finishMeasurement(ordinal), /too early/);
    assert.throws(() => run.clock.resetForNextRun(ordinal), /completed run/);
    for (let second = 1; second <= 60; second++) {
      run.advance(1000);
      epochs.push(run.target.Date.now());
    }
    snapshots.push(run.clock.finishMeasurement(ordinal));
    assert.equal(run.target.Date.now(), fixed + 90000);
    assert.ok(
      epochs.every((value, index) => index === 0 || value > epochs[index - 1]),
    );
    assert.equal(run.target.performance.now, run.nativeNow);
    assert.equal(
      new run.target.Date('2001-01-01T00:00:00Z').getTime(),
      NativeDate.parse('2001-01-01T00:00:00Z'),
    );
    if (ordinal < 10) run.clock.resetForNextRun(ordinal);
  }
});
record('stale-bound-transition-callbacks-cannot-mutate-a-later-run', () => {
  const f = fresh();
  const callbacks = [
    'startWarmup',
    'holdWarmupBoundary',
    'startMeasurement',
    'finishMeasurement',
    'resetForNextRun',
  ].map((name) => () => f.clock[name](1));
  f.clock.startWarmup(1);
  f.advance(30000);
  f.clock.holdWarmupBoundary(1);
  f.clock.startMeasurement(1);
  f.advance(60000);
  f.clock.finishMeasurement(1);
  f.clock.resetForNextRun(1);
  const unchanged = () => {
    const before = f.clock.snapshot();
    for (const callback of callbacks) {
      assert.throws(callback, /belongs to run 1; current run is 2/);
      assert.deepEqual(f.clock.snapshot(), before);
    }
  };
  unchanged();
  f.clock.startWarmup(2);
  unchanged();
  f.advance(30000);
  unchanged();
  f.clock.holdWarmupBoundary(2);
  unchanged();
  f.clock.startMeasurement(2);
  unchanged();
  f.advance(60000);
  unchanged();
  f.clock.finishMeasurement(2);
  unchanged();
});
record('legacy-single-use-callers-remain-valid', () => {
  const f = fresh();
  f.clock.startWarmup();
  f.advance(30000);
  f.clock.holdWarmupBoundary();
  f.clock.startMeasurement();
  f.advance(60000);
  assert.equal(f.clock.finishMeasurement().epochMs, fixed + 90000);
});
record('fresh-document-rejects-global-sample-ordinal', () => {
  const f = fresh();
  assert.throws(
    () => f.clock.startWarmup(2),
    /belongs to run 2; current run is 1/,
  );
  assert.equal(f.clock.snapshot().phase, 'setup');
});

// Execute the real native fleet cadence, with one controlled propagation result.
// No WebGL, real GPU, or complete application claim is made by this reproduction.
const f = fresh();
let propagated = 0;
const state = {
  _enabled: true,
  _params: { showPoints: true, showOrbits: false },
  _trackedNorad: null,
  _lastPropagation: fixed,
  _lastFocusUpdate: 0,
  _activeFocusCount: 0,
  _catalog: new Map([[25544, { group: 'stations', satrec: {} }]]),
  _points: new Map([
    [25544, { position: Cesium.Cartesian3.fromDegrees(-97, 30, 400000) }],
  ]),
  _scratchPropagationCartesian: new Cesium.Cartesian3(),
};
const rendering = createRendering({
  state,
  services: {
    focus: {
      focusNowMs: (now) => now,
      getFocusTarget: () => null,
      focusPassIsNeeded: () => false,
    },
  },
  parts: {
    catalog: { _propagateDenseChunk() {} },
    orbits: {
      propagatePosition(_satrec, now) {
        propagated++;
        return {
          longitude: -97 + (now.getTime() - fixed) / 1000000,
          latitude: 30,
          altitude: 400000,
        };
      },
    },
  },
});
const cycle = (ordinal) => {
  const before = propagated;
  f.clock.startWarmup(ordinal);
  for (let sec = 1; sec <= 30; sec++) {
    f.advance(1000);
    rendering._preRenderTick();
  }
  f.clock.holdWarmupBoundary(ordinal);
  f.clock.startMeasurement(ordinal);
  for (let sec = 1; sec <= 60; sec++) {
    f.advance(1000);
    rendering._preRenderTick();
  }
  f.clock.finishMeasurement(ordinal);
  return {
    runOrdinal: ordinal,
    fleetPropagationCount: propagated - before,
    lastPropagation: state._lastPropagation,
    endEpochMs: f.target.Date.now(),
  };
};
let rewind;
try {
  globalThis.Date = f.target.Date;
  const first = cycle(1);
  f.clock.resetForNextRun(1);
  const second = cycle(2);
  rewind = {
    first,
    second,
    reproduced:
      first.fleetPropagationCount === 90 && second.fleetPropagationCount === 0,
  };
  assert.equal(rewind.reproduced, true);
} finally {
  globalThis.Date = NativeDate;
}
const afterHashes = hashes();
assert.deepEqual(afterHashes, beforeHashes);
const report = {
  schema: 'gev-independent-phased-clock-audit/v1',
  checkedAt: new NativeDate().toISOString(),
  scope:
    'Node clock controls and real satellite-rendering cadence with a stubbed propagation result; no browser, hardware, or application acceptance.',
  sourceHashesBefore: beforeHashes,
  sourceHashesAfter: afterHashes,
  checks,
  completedRunSnapshots: snapshots,
  nativeRewindFailure: rewind,
  conclusion:
    'Run guards work in isolation. Reusing application state after a wall-clock rewind suppresses satellite fleet propagation; sample isolation or a complete native lifecycle reset is required before capture acceptance.',
};
writeFileSync(
  new URL('phase-clock-audit.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    controls: checks.length,
    pass: checks.every((item) => item.pass),
    nativeRewindFailure: rewind,
    sourceUnchanged: true,
  }),
);
