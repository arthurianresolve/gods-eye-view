import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOCUS_UPDATE_MS,
  VISIBILITY_UPDATE_MS,
} from '../../src/layers/vessels/policy.js';
import {
  compareVesselRenderDemandRuns,
  validateVesselRenderDemandReport,
} from './vesselRenderDemand.mjs';

const commit = 'a'.repeat(40);
const fixture = 'b'.repeat(64);
const image = 'c'.repeat(64);
const phasePlan = [
  ['idleBefore', 3000, 50, 8, 0],
  ['focusActive', 800, 40, 10, 3000],
  ['focusRelease', 1000, 45, 10, 3800],
  ['idleAfter', 2000, 35, 5, 4800],
];

function run(mode, frameFactor = 1) {
  const candidate = mode === 'candidate';
  const phases = phasePlan.map(
    ([
      name,
      durationMs,
      controlFrames,
      nonBackgroundPixels,
      startElapsedMs,
    ]) => ({
      name,
      requestedDurationMs: durationMs,
      elapsedMs: durationMs,
      startElapsedMs,
      endElapsedMs: startElapsedMs + durationMs,
      completedFrames: Math.round(
        controlFrames *
          (candidate && name.startsWith('idle') ? frameFactor : 1),
      ),
      frameOverflow: false,
      alphaOverflow: false,
      visibleVesselCount: 32,
      minAlpha: name === 'focusActive' ? 120 : 255,
      endMinAlpha: 255,
      endDimmedVesselCount: name === 'focusActive' ? 1 : 0,
      requestRenderModeAtEnd: candidate,
      nonBackgroundPixels,
      rgbaSha256: image,
    }),
  );
  const scheduledUpdates = candidate
    ? [
        ...[1000, 1800, 2600].map((firedAt) => ({
          requestedDelayMs: VISIBILITY_UPDATE_MS,
          actualDelayMs: VISIBILITY_UPDATE_MS,
          completed: true,
          requestedPhase: 'candidate-setup',
          firedPhase: 'idleBefore',
          firedAt,
        })),
        ...[3100, 3180, 3260, 3340].map((firedAt) => ({
          requestedDelayMs: FOCUS_UPDATE_MS,
          actualDelayMs: FOCUS_UPDATE_MS,
          completed: true,
          requestedPhase: 'candidate-focus-active',
          firedPhase: 'focusActive',
          firedAt,
        })),
        ...[5000, 5800].map((firedAt) => ({
          requestedDelayMs: VISIBILITY_UPDATE_MS,
          actualDelayMs: VISIBILITY_UPDATE_MS,
          completed: true,
          requestedPhase: 'candidate-idle-after',
          firedPhase: 'idleAfter',
          firedAt,
        })),
        {
          requestedDelayMs: 12,
          actualDelayMs: null,
          completed: false,
          requestedPhase: 'candidate-idle-after',
          firedPhase: null,
          firedAt: null,
        },
      ]
    : [];
  return {
    schema: 'gev-vessel-render-demand/v1',
    status: 'passed',
    mode,
    applicationCommit: commit,
    harnessCommit: commit,
    fixtureSha256: fixture,
    fixtureEpochMs: Date.UTC(2026, 9, 8, 12),
    fixtureClock: { epochMs: Date.UTC(2026, 9, 8, 12), shouldAnimate: false },
    scope: 'isolated synthetic billboard-only fixture',
    population: 32,
    viewport: { width: 1200, height: 960, devicePixelRatio: 1 },
    renderingSettings: {
      requestRenderMode: true,
      maximumRenderTimeChange: 'Infinity',
      msaaSamples: 4,
      drawingBufferWidth: 1200,
      drawingBufferHeight: 960,
      devicePixelRatio: 1,
      contextAttributes: { antialias: true },
    },
    phases,
    focusPasses: candidate
      ? [
          ...[3120, 3200, 3280, 3360].map((elapsedMs) => ({
            phase: 'focusActive',
            elapsedMs,
          })),
          ...[3920, 4000, 4080, 4160].map((elapsedMs) => ({
            phase: 'focusRelease',
            elapsedMs,
          })),
        ]
      : [],
    visibilityPasses: candidate
      ? [
          ...[1000, 1800, 2600].map((elapsedMs) => ({
            phase: 'idleBefore',
            elapsedMs,
          })),
          ...[5000, 5800].map((elapsedMs) => ({
            phase: 'idleAfter',
            elapsedMs,
          })),
        ]
      : [],
    scheduledUpdates,
    cleanup: {
      layerDestroyed: true,
      renderDemandDisposed: true,
      viewerDestroyed: true,
      governorUninstalled: true,
    },
  };
}

function report() {
  const pairs = [];
  for (let pair = 0; pair < 5; pair++) {
    const control = run('control');
    const candidate = run('candidate', 0.2);
    const runs = pair % 2 === 0 ? [control, candidate] : [candidate, control];
    const comparison = compareVesselRenderDemandRuns(control, candidate, {
      expectedCommit: commit,
    });
    pairs.push({
      pair,
      order: runs.map((entry) => entry.mode),
      runs,
      comparison: { phaseResults: comparison.phaseResults },
    });
  }
  return {
    schema: 'gev-vessel-render-demand/v1',
    status: 'passed',
    mode: 'paired',
    applicationCommit: commit,
    harnessCommit: commit,
    fixtureEpochMs: Date.UTC(2026, 9, 8, 12),
    fixtureClock: { epochMs: Date.UTC(2026, 9, 8, 12), shouldAnimate: false },
    scope: 'isolated synthetic billboard-only fixture',
    environment: {
      renderer: 'Test renderer',
      graphics: {
        drawingBufferWidth: 1200,
        drawingBufferHeight: 960,
        contextAttributes: { antialias: true },
      },
    },
    viewport: { width: 1200, height: 960, devicePixelRatio: 1 },
    renderingSettings: run('control').renderingSettings,
    cadencePolicyMs: {
      idleVisibility: VISIBILITY_UPDATE_MS,
      activeFocus: FOCUS_UPDATE_MS,
    },
    cleanup: {
      viewerDestroyed: true,
      governorUninstalled: true,
      viewerDestroyedCount: 10,
      governorUninstalledCount: 10,
    },
    pairs,
  };
}

test('paired vessel report validates exact alternating trials, output and idle reduction', () => {
  const value = report();
  assert.equal(
    validateVesselRenderDemandReport(value, { expectedCommit: commit }),
    value,
  );
});

test('vessel report rejects wrong identities, pair order, rendering settings and missed idle reduction', () => {
  const wrongCommit = report();
  wrongCommit.pairs[0].runs[0].harnessCommit = 'd'.repeat(40);
  assert.throws(
    () =>
      validateVesselRenderDemandReport(wrongCommit, { expectedCommit: commit }),
    /commit identity/,
  );

  const wrongOrder = report();
  wrongOrder.pairs.reverse();
  assert.throws(
    () =>
      validateVesselRenderDemandReport(wrongOrder, { expectedCommit: commit }),
    /exactly 0 through 4/,
  );

  const wrongSettings = report();
  wrongSettings.pairs[0].runs[0].renderingSettings.msaaSamples = 2;
  assert.throws(
    () =>
      validateVesselRenderDemandReport(wrongSettings, {
        expectedCommit: commit,
      }),
    /run commit identity or settings mismatch/,
  );

  const noReduction = report();
  noReduction.pairs[0].runs
    .find((entry) => entry.mode === 'candidate')
    .phases.find((entry) => entry.name === 'idleBefore').completedFrames = 50;
  assert.throws(
    () =>
      validateVesselRenderDemandReport(noReduction, { expectedCommit: commit }),
    /did not reduce repeated idle frames/,
  );
});

test('vessel phase evidence requires focused dimming, restored alpha, visible output and duration bounds', () => {
  const focused = run('control');
  focused.phases[1].minAlpha = 255;
  assert.throws(
    () =>
      compareVesselRenderDemandRuns(focused, run('candidate', 0.2), {
        expectedCommit: commit,
      }),
    /not observed dimmed/,
  );

  const invisible = run('control');
  invisible.phases[0].nonBackgroundPixels = 0;
  assert.throws(
    () =>
      compareVesselRenderDemandRuns(invisible, run('candidate', 0.2), {
        expectedCommit: commit,
      }),
    /non-background/,
  );

  const slow = run('control');
  slow.phases[0].elapsedMs = 4000;
  assert.throws(
    () =>
      compareVesselRenderDemandRuns(slow, run('candidate', 0.2), {
        expectedCommit: commit,
      }),
    /timing/,
  );
});

test('candidate cadence uses observed production passes and permits setup/interleaved wakes', () => {
  const value = report();
  const candidate = value.pairs[0].runs.find(
    (entry) => entry.mode === 'candidate',
  );
  candidate.scheduledUpdates[0].firedPhase = 'candidate-setup';
  candidate.scheduledUpdates[0].actualDelayMs = 810;
  candidate.scheduledUpdates[1].firedAt = 1705;
  candidate.scheduledUpdates[2].firedAt = 2580;
  candidate.scheduledUpdates[3].actualDelayMs = 42;
  candidate.scheduledUpdates[3].firedAt = 3142;
  candidate.scheduledUpdates.push({
    requestedPhase: 'focusRelease',
    requestedDelayMs: VISIBILITY_UPDATE_MS,
    completed: false,
    actualDelayMs: null,
    firedAt: null,
    firedPhase: null,
  });
  assert.equal(
    validateVesselRenderDemandReport(value, { expectedCommit: commit }),
    value,
  );

  candidate.focusPasses = candidate.focusPasses.filter(
    (entry) => entry.phase !== 'focusActive',
  );
  assert.throws(
    () => validateVesselRenderDemandReport(value, { expectedCommit: commit }),
    /focusActive production passes/,
  );
});
