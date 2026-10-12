import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as Cesium from 'cesium';
import { createRendering } from '../../../../src/layers/satellites/rendering.js';
import { installPhasedMonotonicWallClock } from '../../../../scripts/performance/productionFlightFixture.mjs';

const NativeDate = Date;
const fixed = NativeDate.parse('2026-10-12T18:00:00.000Z');
const root = new URL('../../../../', import.meta.url);
const sources = [
  'src/layers/satellites/rendering.js',
  'scripts/performance/productionFlightFixture.mjs',
];
const hashes = () => Object.fromEntries(sources.map((name) => [name,
  createHash('sha256').update(readFileSync(new URL(name, root))).digest('hex'),
]));
const sourceSha256 = hashes();
const results = [];
for (const frameStepMs of [16, 33, 120]) {
  let monotonicMs = 0;
  const target = { Date: NativeDate, performance: { now: () => monotonicMs } };
  installPhasedMonotonicWallClock(fixed, 30000, 60000, target);
  const clock = target.__gevPhasedMonotonicWallClockV1;
  let lastPositionTime = null;
  let propagationCount = 0;
  const point = { position: Cesium.Cartesian3.fromDegrees(-97, 30, 400000) };
  const state = {
    _enabled: true,
    _params: { showPoints: true, showOrbits: false },
    _trackedNorad: null,
    _lastPropagation: fixed,
    _lastFocusUpdate: 0,
    _activeFocusCount: 0,
    _catalog: new Map([[25544, { group: 'stations', satrec: {} }]]),
    _points: new Map([[25544, point]]),
    _scratchPropagationCartesian: new Cesium.Cartesian3(),
  };
  const rendering = createRendering({
    state,
    services: { focus: {
      focusNowMs: (now) => now,
      getFocusTarget: () => null,
      focusPassIsNeeded: () => false,
    } },
    parts: {
      catalog: { _propagateDenseChunk() {} },
      orbits: { propagatePosition(_satrec, when) {
        lastPositionTime = when.getTime();
        propagationCount++;
        return { longitude: -97 + (lastPositionTime - fixed) / 1000000,
          latitude: 30, altitude: 400000 };
      } },
    },
  });
  const advance = (duration) => {
    const end = monotonicMs + duration;
    while (monotonicMs + frameStepMs < end) {
      monotonicMs += frameStepMs;
      rendering._preRenderTick();
    }
    monotonicMs = end;
    rendering._preRenderTick();
  };
  const snapshot = () => ({
    wallEpochMs: target.Date.now(),
    lastPositionEpochMs: lastPositionTime,
    positionAgeMs: target.Date.now() - lastPositionTime,
    cartesian: { x: point.position.x, y: point.position.y, z: point.position.z },
  });
  try {
    globalThis.Date = target.Date;
    clock.startWarmup(1);
    advance(30000);
    clock.holdWarmupBoundary(1);
    rendering._preRenderTick();
    const before = snapshot();
    clock.startMeasurement(1);
    advance(60000);
    clock.finishMeasurement(1);
    rendering._preRenderTick();
    results.push({ frameStepMs, propagationCount, before, after: snapshot() });
  } finally {
    globalThis.Date = NativeDate;
  }
}
assert.deepEqual(hashes(), sourceSha256);
for (const boundary of ['before', 'after']) {
  assert.equal(new Set(results.map((row) => row[boundary].wallEpochMs)).size, 1);
  assert.equal(new Set(results.map((row) => row[boundary].lastPositionEpochMs)).size, 3);
  assert.equal(new Set(results.map((row) => JSON.stringify(row[boundary].cartesian))).size, 3);
}
const report = {
  schema: 'gev-native-satellite-boundary-cadence-audit/v1',
  recordedAt: new NativeDate().toISOString(),
  scope: 'Fresh native renderer state and production fixture clock with one controlled propagation result; simulated render cadence, no WebGL, hardware or orbital-accuracy claim',
  sourceSha256,
  sourceStable: true,
  results,
  reproduced: true,
  conclusion: 'Equal held fixture-clock epochs do not imply identical cached satellite positions. Exact position hashes cannot be assumed comparable across different native rendering cadences. The capture must establish deterministic source sampling or explicitly validate sampled source times before matched acceptance.',
};
writeFileSync(new URL('satellite-boundary-cadence.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ reproduced: true, sourceStable: true, results }));
