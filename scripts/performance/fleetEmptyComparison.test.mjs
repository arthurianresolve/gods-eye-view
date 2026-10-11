import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFleetEmptyLifecycle } from './fleetComparison.mjs';

const COMMIT = 'b'.repeat(40);
const PASSED_CHECKS = ['population', 'foreground', 'no-render-errors'].map(
  (id) => ({ id, status: 'passed' }),
);

function frame(population, scheduledUpdates = 0, ready = true) {
  return {
    population: { ...population },
    sceneBillboards: { ...population },
    billboardsReady: { civil: ready, military: ready },
    billboardsShown: { civil: ready, military: ready },
    demand: { holds: 0, scheduledUpdates },
  };
}

function emptyPhase(name) {
  return {
    name,
    absentSnapshots: [1, 2, 3].map((absencePoll) => ({
      absencePoll,
      counts: { civil: 0, military: 0 },
      sceneBillboards: { civil: 0, military: 0 },
    })),
    finalFrame: frame({ civil: 0, military: 0 }),
    drained: frame({ civil: 0, military: 0 }),
  };
}

function validSample() {
  return {
    schema: 'gev-fleet-render-demand/v4',
    status: 'passed',
    applicationCommit: COMMIT,
    harnessCommit: COMMIT,
    mode: 'empty-lifecycle',
    implementation: 'candidate',
    pageErrors: [],
    checks: PASSED_CHECKS.map((entry) => ({ ...entry })),
    settings: {
      resolutionScale: 1,
      msaaSamples: 4,
      context: { antialias: true, preserveDrawingBuffer: true },
      environment: {
        appCommit: COMMIT,
        harnessCommit: COMMIT,
        viewport: { width: 960, height: 640, dpr: 1 },
        drawingBuffer: { width: 960, height: 640 },
      },
    },
    cleanup: {
      viewerDestroyed: true,
      governor: { installed: false, holds: [], scheduledUpdates: [] },
      beforeUninstall: { holds: [], scheduledUpdates: [] },
      failures: [],
    },
    emptyLifecycle: {
      schema: 'gev-fleet-empty-lifecycle/v1',
      status: 'passed',
      requestedIdleMs: 10_000,
      maxIdleFrames: 2,
      checks: [
        'initial-population-present',
        'empty-final-frame',
        'empty-no-periodic-demand',
        'source-rearrival-resumes-cadence',
        'ten-second-idle-frame-bound',
        'full-source-recovery',
      ].map((id) => ({ id, status: 'passed' })),
      phases: [
        emptyPhase('empty-first'),
        {
          name: 'repopulate',
          frame: frame({ civil: 1, military: 1 }, 2),
        },
        {
          ...emptyPhase('empty-again'),
          idle: {
            requestedMs: 10_000,
            observedMs: 10_004,
            frames: 1,
            maxFrames: 2,
            demandStart: { holds: 0, scheduledUpdates: 0 },
            demandEnd: { holds: 0, scheduledUpdates: 0 },
          },
        },
        {
          name: 'recovery',
          frame: frame({ civil: 12, military: 8 }, 2),
        },
      ],
    },
  };
}

const report = { candidate: COMMIT, harness: COMMIT };

test('accepts a complete empty-fleet lifecycle report', () => {
  assert.deepEqual(validateFleetEmptyLifecycle(validSample(), report), {
    status: 'passed',
    emptyIdleFrames: 1,
    emptyIdleMs: 10_004,
  });
});

test('rejects idle evidence with too many frames or too little elapsed time', () => {
  const tooManyFrames = validSample();
  tooManyFrames.emptyLifecycle.phases[2].idle.frames = 3;
  assert.throws(() => validateFleetEmptyLifecycle(tooManyFrames, report));

  const tooShort = validSample();
  tooShort.emptyLifecycle.phases[2].idle.observedMs = 9_999;
  assert.throws(() => validateFleetEmptyLifecycle(tooShort, report));
});

test('rejects missing cleanup, recovery, wrong commit, and missing readiness', () => {
  const missingCleanup = validSample();
  delete missingCleanup.cleanup.viewerDestroyed;
  assert.throws(() => validateFleetEmptyLifecycle(missingCleanup, report));

  const missingRecovery = validSample();
  missingRecovery.emptyLifecycle.phases.pop();
  assert.throws(() => validateFleetEmptyLifecycle(missingRecovery, report));

  const wrongCommit = validSample();
  wrongCommit.applicationCommit = 'c'.repeat(40);
  assert.throws(() => validateFleetEmptyLifecycle(wrongCommit, report));

  const missingReadiness = validSample();
  delete missingReadiness.emptyLifecycle.phases[1].frame.billboardsReady;
  assert.throws(() => validateFleetEmptyLifecycle(missingReadiness, report));
});
