import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { compareOverlayAttributionArms } from './overlayAttributionContract.mjs';

function fixtureArm({ enabled, profile = 'generic', entries = 4 } = {}) {
  const sourceCommit = 'a'.repeat(40);
  const descriptor = {
    schema: 'gev-overlay-attribution-fixture/v1',
    sourceCommit,
    profile,
    entryCount: entries,
    pairIndex: 0,
    viewportWidth: 1_600,
    viewportHeight: 900,
    dpr: 2,
    frameMs: 16,
    virtualStartTimeMs: 0,
    solveIntervalMs: 125,
    warmupFrames: 3,
    settleFrames: 2,
    measuredFrames: 2,
    cameraPath: 'fixed-scene-camera',
    motionPath: 'seeded-sinusoidal-frame-v1',
  };
  const fixture = {
    schema: descriptor.schema,
    descriptor,
    sha256: createHash('sha256')
      .update(JSON.stringify(descriptor))
      .digest('hex'),
  };
  return {
    ok: true,
    schema: 'gev-overlay-cpu-arm/v1',
    status: 'complete',
    sourceCommit,
    profile,
    entryCount: entries,
    pairIndex: 0,
    timingEnabled: enabled,
    fixture,
    start: {
      frame: 5,
      virtualTimeMs: 80,
      population: {
        kind: 'world-overlay',
        candidateCount: entries,
        paintedCount: 2,
        paintedBySource: { 'alloc-probe': 2 },
        workloadSourceIds: ['alloc-probe'],
      },
    },
    end: {
      frame: 7,
      virtualTimeMs: 112,
      population: {
        kind: 'world-overlay',
        candidateCount: entries,
        paintedCount: 2,
        paintedBySource: { 'alloc-probe': 2 },
        workloadSourceIds: ['alloc-probe'],
      },
    },
    frames: 2,
    cpuMs: enabled ? 0.4 : 0.2,
    cpuMsPerFrame: enabled ? 0.2 : 0.1,
    cpuTimings: enabled
      ? {
          enabled: true,
          scope: 'synchronous-application-cpu',
          overflow: false,
          series: [{ label: 'fixture', count: 2, totalMs: 0.4 }],
        }
      : null,
  };
}

function runWorkerArm({ profile, entries, enabled }) {
  const output = execFileSync(
    process.execPath,
    ['src/overlays/worldOverlayAllocation.worker.mjs'],
    {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        GEV_OVERLAY_CPU: '1',
        GEV_ALLOC_PROFILE: profile,
        GEV_ALLOC_ENTRIES: String(entries),
        GEV_ALLOC_WARMUP: '4',
        GEV_ALLOC_MATCHED_SETTLE_FRAMES: '2',
        GEV_ALLOC_MATCHED_MEASURE_FRAMES: '3',
        GEV_ALLOC_MATCHED_ARM: enabled ? 'enabled' : 'disabled',
        GEV_ALLOC_SOURCE_COMMIT: 'b'.repeat(40),
        GEV_ALLOC_PAIR_INDEX: '1',
      },
    },
  );
  return JSON.parse(output.trim().split('\n').at(-1));
}

test('matched CPU arms reject identity, frame and population drift', () => {
  const disabled = fixtureArm({ enabled: false });
  const enabled = fixtureArm({ enabled: true });
  const pair = compareOverlayAttributionArms(disabled, enabled);
  assert.equal(pair.instrumentationRatio, 1);
  for (const mutate of [
    (arm) => (arm.sourceCommit = 'c'.repeat(40)),
    (arm) => (arm.fixture.descriptor.viewportWidth = 1),
    (arm) => (arm.start.frame += 1),
    (arm) => (arm.end.population.candidateCount += 1),
    (arm) => (arm.start.population.paintedBySource['alloc-probe'] += 1),
  ]) {
    const changed = structuredClone(enabled);
    mutate(changed);
    if (changed.fixture) {
      changed.fixture.sha256 = createHash('sha256')
        .update(JSON.stringify(changed.fixture.descriptor))
        .digest('hex');
    }
    assert.throws(() => compareOverlayAttributionArms(disabled, changed));
  }
  const malformed = structuredClone(disabled);
  malformed.start.population.workloadSourceIds = [];
  const malformedPeer = structuredClone(enabled);
  malformedPeer.start.population.workloadSourceIds = [];
  assert.throws(() => compareOverlayAttributionArms(malformed, malformedPeer));
});

test('fresh all-radio worker arms retain identical source populations and route frames', () => {
  const disabled = runWorkerArm({
    profile: 'all-live-radio',
    entries: 864,
    enabled: false,
  });
  const enabled = runWorkerArm({
    profile: 'all-live-radio',
    entries: 864,
    enabled: true,
  });
  const pair = compareOverlayAttributionArms(disabled, enabled);
  assert.equal(pair.frames, 3);
  assert.ok(pair.population.candidateCount > 0);
  assert.ok(pair.population.paintedCount > 0);
  assert.deepEqual(
    pair.population.paintedBySource,
    enabled.end.population.paintedBySource,
  );
  assert.equal(disabled.start.frame, enabled.start.frame);
  assert.equal(disabled.end.virtualTimeMs, enabled.end.virtualTimeMs);
});

test('detection attribution reports detection observations instead of overlay paint counters', () => {
  const disabled = runWorkerArm({
    profile: 'phase6-detection',
    entries: 5_000,
    enabled: false,
  });
  const enabled = runWorkerArm({
    profile: 'phase6-detection',
    entries: 5_000,
    enabled: true,
  });
  const pair = compareOverlayAttributionArms(disabled, enabled);
  assert.equal(pair.population.kind, 'detection-observations');
  assert.equal(pair.population.observationCount, 5_000);
  assert.equal(pair.population.profile, 'DENSE');
  assert.ok(pair.population.visibleCount > 0);
  assert.equal(Object.hasOwn(pair.population, 'paintedCount'), false);
});
