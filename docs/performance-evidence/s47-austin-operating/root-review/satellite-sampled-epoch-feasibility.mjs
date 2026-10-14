import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as Cesium from 'cesium';
import { twoline2satrec } from 'satellite.js';
import { createRendering } from '../../../../src/layers/satellites/rendering.js';
import { createControls } from '../../../../src/layers/satellites/controls.js';
import { createOrbits } from '../../../../src/layers/satellites/orbits.js';
import { CATALOG_GROUPS } from '../../../../src/layers/satellites/policy.js';
import {
  parseTleText,
  decodeTleCatalogNumber,
} from '../../../../src/sources/tle.js';
import { installPhasedMonotonicWallClock } from '../../../../scripts/performance/productionFlightFixture.mjs';

// Feasibility audit only: this does not change the benchmark or its acceptance.
const NativeDate = Date;
const fixed = NativeDate.parse('2026-10-12T18:00:00Z');
const root = new URL('../../../../', import.meta.url);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const paths = [
  'src/layers/satellites/rendering.js',
  'src/layers/satellites/controls.js',
  'src/layers/satellites/orbits.js',
  'src/layers/satellites/policy.js',
  'src/sources/tle.js',
  'scripts/performance/productionFlightFixture.mjs',
  ...CATALOG_GROUPS.map(
    ({ path }) => `src/data/fixtures/austin-operating-v1/tle/${path}.tle`,
  ),
];
const hashes = () =>
  Object.fromEntries(
    paths.map((path) => [path, hash(readFileSync(new URL(path, root)))]),
  );
const sourceSha256 = hashes();
function catalog() {
  const result = new Map();
  for (const group of CATALOG_GROUPS) {
    const text = readFileSync(
      new URL(
        `src/data/fixtures/austin-operating-v1/tle/${group.path}.tle`,
        root,
      ),
      'utf8',
    );
    for (const row of parseTleText(text)) {
      const satrec = twoline2satrec(row.line1, row.line2);
      const id = decodeTleCatalogNumber(satrec.satnum);
      if (id === null || satrec.error !== 0 || result.has(id)) continue;
      result.set(id, { name: row.name, group: group.tag, satrec });
    }
  }
  assert.equal(result.size, 828);
  return result;
}
const orbits = createOrbits({ state: {}, services: {}, parts: {}, source: {} });
function positionFor(entry, epochMs) {
  const position = orbits.propagatePosition(
    entry.satrec,
    new NativeDate(epochMs),
  );
  assert.ok(position);
  return Cesium.Cartesian3.fromDegrees(
    position.longitude,
    position.latitude,
    position.altitude,
  );
}
function positionRecord(id, position) {
  const cartographic = Cesium.Cartographic.fromCartesian(position);
  return {
    id,
    longitude: Cesium.Math.toDegrees(cartographic.longitude),
    latitude: Cesium.Math.toDegrees(cartographic.latitude),
    altitudeM: cartographic.height,
  };
}
const observedCartesian = (row) =>
  Cesium.Cartesian3.fromDegrees(row.longitude, row.latitude, row.altitudeM);
const TOLERANCE_METERS = 0.001;
function deriveSampledEpoch(records, boundaryEpochMs, referenceCatalog) {
  if (
    records.length !== referenceCatalog.size ||
    new Set(records.map((row) => row.id)).size !== records.length
  )
    throw new Error('Observed catalog identities are incomplete.');
  if (records.some((row) => !referenceCatalog.has(row.id)))
    throw new Error('Observed catalog contains an unknown identity.');
  const witness = records.find((row) => row.id === 25544);
  if (!witness) throw new Error('ISS position witness is missing.');
  const observed = observedCartesian(witness);
  const candidateEpochs = [];
  for (let epoch = boundaryEpochMs - 1000; epoch <= boundaryEpochMs; epoch++) {
    const distance = Cesium.Cartesian3.distance(
      observed,
      positionFor(referenceCatalog.get(25544), epoch),
    );
    if (distance <= TOLERANCE_METERS) candidateEpochs.push(epoch);
  }
  if (candidateEpochs.length !== 1)
    throw new Error('No unique fresh sampled epoch.');
  const epochMs = candidateEpochs[0];
  let maximumResidualMeters = 0;
  for (const row of records) {
    const residual = Cesium.Cartesian3.distance(
      observedCartesian(row),
      positionFor(referenceCatalog.get(row.id), epochMs),
    );
    if (!Number.isFinite(residual) || residual > TOLERANCE_METERS)
      throw new Error(
        'Cached positions do not share the derived sampled epoch.',
      );
    maximumResidualMeters = Math.max(maximumResidualMeters, residual);
  }
  return {
    epochMs,
    ageMs: boundaryEpochMs - epochMs,
    matchedCount: records.length,
    maximumResidualMeters,
  };
}
const recordsByBoundary = [];
const results = [];
for (const frameStepMs of [16, 33, 120]) {
  let monotonicMs = 0;
  const target = { Date: NativeDate, performance: { now: () => monotonicMs } };
  installPhasedMonotonicWallClock(fixed, 30000, 60000, target);
  const clock = target.__gevPhasedMonotonicWallClockV1;
  const state = {
    _enabled: true,
    _params: { showPoints: true, showOrbits: false },
    _trackedNorad: null,
    _lastPropagation: fixed,
    _lastFocusUpdate: 0,
    _activeFocusCount: 0,
    _denseIds: [],
    _catalog: catalog(),
    _points: new Map(),
    _scratchPropagationCartesian: new Cesium.Cartesian3(),
  };
  for (const [id, entry] of state._catalog) {
    let current = positionFor(entry, fixed);
    state._points.set(id, {
      get position() {
        return current;
      },
      // Cesium's real primitive setter clones the shared scratch Cartesian.
      set position(value) {
        current = Cesium.Cartesian3.clone(value, current);
      },
    });
  }
  const rendering = createRendering({
    state,
    services: {
      focus: {
        focusNowMs: (value) => value,
        getFocusTarget: () => null,
        focusPassIsNeeded: () => false,
      },
    },
    parts: { catalog: { _propagateDenseChunk() {} }, orbits },
  });
  const controls = createControls({
    state,
    services: { layerState: {} },
    parts: {},
    source: {},
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
  const snapshot = (boundary) => {
    const records = controls.methods
      .getAllPositions(1000)
      .map(({ id, longitude, latitude, altitudeM }) => ({
        id,
        longitude,
        latitude,
        altitudeM,
      }));
    const boundaryEpochMs = target.Date.now();
    const inferred = deriveSampledEpoch(records, boundaryEpochMs, catalog());
    // Ground truth is checked only here; derivation receives public readback.
    assert.equal(inferred.epochMs, state._lastPropagation);
    recordsByBoundary.push({ records, boundaryEpochMs, inferred });
    return {
      boundary,
      boundaryEpochMs,
      groundTruthEpochMs: state._lastPropagation,
      inferred,
      rawPositionSha256: hash(JSON.stringify(records)),
    };
  };
  try {
    globalThis.Date = target.Date;
    clock.startWarmup(1);
    advance(30000);
    clock.holdWarmupBoundary(1);
    rendering._preRenderTick();
    const before = snapshot('warmup-held');
    clock.startMeasurement(1);
    advance(60000);
    clock.finishMeasurement(1);
    rendering._preRenderTick();
    const after = snapshot('complete');
    results.push({ frameStepMs, before, after });
  } finally {
    globalThis.Date = NativeDate;
  }
}
const control = recordsByBoundary[0];
const negativeControls = [];
function rejected(
  label,
  records,
  boundaryEpochMs = control.boundaryEpochMs,
  referenceCatalog = catalog(),
) {
  assert.throws(() =>
    deriveSampledEpoch(records, boundaryEpochMs, referenceCatalog),
  );
  negativeControls.push({ label, rejected: true });
}
rejected('one record missing', control.records.slice(1));
rejected('duplicate identity', [
  ...control.records.slice(1),
  control.records[1],
]);
rejected(
  'cached fleet older than one-second cadence',
  control.records,
  control.boundaryEpochMs + 1001,
);
const displaced = structuredClone(control.records);
displaced.find((row) => row.id !== 25544).altitudeM += 1;
rejected('one cached position displaced by one meter', displaced);
const mixedEpoch = structuredClone(control.records);
const nonWitness = mixedEpoch.find((row) => row.id === 48274);
Object.assign(
  nonWitness,
  positionRecord(
    nonWitness.id,
    positionFor(catalog().get(nonWitness.id), control.inferred.epochMs - 1000),
  ),
);
rejected('one record from a different epoch', mixedEpoch);
const wrongCatalog = catalog();
wrongCatalog.get(nonWitness.id).satrec = wrongCatalog.get(25544).satrec;
rejected(
  'wrong source orbit for one identity',
  control.records,
  control.boundaryEpochMs,
  wrongCatalog,
);
assert.deepEqual(hashes(), sourceSha256);
const report = {
  schema: 'gev-satellite-sampled-epoch-feasibility/v1',
  recordedAt: new NativeDate().toISOString(),
  scope:
    'Host-only native fleet renderer, native controls and SGP4 with pinned TLEs; simulated frame delivery and clone-equivalent point records. No browser/GPU, cross-engine precision or visual equivalence acceptance.',
  method:
    'Derive the unique integer-millisecond epoch from ISS public cached position within the previous 1000 ms; verify every observed cached position against the independent reference catalog at that epoch. Ground truth used only for this feasibility assertion.',
  candidateToleranceMeters: TOLERANCE_METERS,
  negativeControlCorrection:
    'An initial wrong-orbit negative used POISK versus ISS, which share the same physical orbit in the pinned source and therefore did not create a position error. The distinct-orbit negative now uses CSS (48274) versus ISS. Source-byte and identity validation must remain separate; position validation cannot distinguish physically identical trajectories.',
  sourceSha256,
  sourceStable: true,
  results,
  negativeControls,
  conclusion:
    'Explicit sampled-time validation is feasible in this host-only control without modifying native cadence or discarding raw position hashes. Capture integration, cross-engine precision verification and paired visual acceptance remain pending.',
};
writeFileSync(
  new URL('satellite-sampled-epoch-feasibility.json', import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
  { flag: 'wx' },
);
console.log(JSON.stringify({ results, negativeControls, sourceStable: true }));
