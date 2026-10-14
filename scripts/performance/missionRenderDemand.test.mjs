import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateMissionRenderDemandReport } from './missionRenderDemand.mjs';

const scenarios = ['static-empty', 'unselected-orbit', 'selected-live'];
const variants = ['continuous-control', 'demand-candidate'];

function makeTrial(scenario, variant, repeat) {
  const empty = scenario === 'static-empty';
  const selected = scenario === 'selected-live';
  const count = empty ? 0 : 2;
  const frames =
    variant === 'continuous-control'
      ? 180
      : selected
        ? 178
        : scenario === 'unselected-orbit'
          ? 3
          : 1;
  const mode =
    variant === 'continuous-control' || selected ? 'continuous' : 'idle';
  const sceneEntityIds = empty
    ? []
    : [
        'rocket-launch:mission-a',
        'rocket-launch:mission-b',
        'rocket-satellite:mission-a',
        'rocket-satellite:mission-b',
        'rocket-transfer:mission-a',
        'rocket-transfer:mission-b',
        'rocket-vehicle:mission-a',
        'rocket-vehicle:mission-b',
      ];
  const camera = {
    position: [1, 2, 3],
    direction: [0, 0, -1],
    up: [0, 1, 0],
  };
  const cloneCamera = () => ({
    position: [...camera.position],
    direction: [...camera.direction],
    up: [...camera.up],
  });
  const referenceEpochMs = 1_800_000_000_000;
  const fixtureSource = {
    referenceEpochMs,
    inputLaunchNets: empty
      ? []
      : [
          {
            id: 'mission-a',
            net: new Date(referenceEpochMs - 3_600_000).toISOString(),
          },
          {
            id: 'mission-b',
            net: new Date(referenceEpochMs - 7_200_000).toISOString(),
          },
        ],
    effectiveLaunchTimes: empty
      ? []
      : [
          { id: 'mission-a', launchTimeMs: referenceEpochMs - 3_600_000 },
          { id: 'mission-b', launchTimeMs: referenceEpochMs - 7_200_000 },
        ],
    inputsStableAcrossTrials: true,
    nativeSchedulingClockPatched: false,
  };
  const cameraFlight = {
    status: 'completed',
    elapsedMs: 2_400 + repeat * 3 + (variant === 'demand-candidate' ? 11 : 0),
  };
  const visualSettings = {
    viewportWidth: 960,
    viewportHeight: 640,
    canvasClientWidth: 960,
    canvasClientHeight: 640,
    canvasWidth: 960,
    canvasHeight: 640,
    viewerResolutionScale: 1,
    msaaSamples: 4,
    maximumRenderTimeChange: 'Infinity',
    imageryLayerCount: 0,
    globe: false,
    skyBox: false,
    skyAtmosphere: false,
  };
  return {
    schema: 'gev-mission-render-demand-trial/v1',
    status: 'passed',
    scenario,
    variant,
    repeat,
    durationMs: empty ? 10_000 : 3_000,
    measurementElapsedMs: empty ? 10_001 : 3_001,
    rendering: {
      frameCount: frames,
      frameSampleOverflow: false,
      finalFrameCompletedAfterMeasurement: true,
      finalSettlingFrameExcluded: true,
      renderModeAtStart: mode,
      renderModeAtEnd: mode,
      cesiumRequestRenderModeAtStart: mode === 'idle',
    },
    cameraFlight,
    matrixUpdates: {
      countDuringMeasurement: empty
        ? 0
        : variant === 'demand-candidate'
          ? 2
          : 3,
      finalMatrix: Array.from({ length: 16 }, (_, index) => index),
    },
    liveTrack: {
      sampleCountDuringMeasurement: selected ? 180 : 0,
      firstPosition: selected
        ? { longitude: 0, latitude: 0, altitude: 550_000 }
        : null,
      lastPosition: selected
        ? { longitude: 0.2, latitude: 0.01, altitude: 550_000 }
        : null,
    },
    fixtureClock: {
      startedOnce: true,
      endedClamped: true,
      heldEpochMsBeforeMeasurement: 1_000,
      endEpochMs: 1_000 + (empty ? 10_000 : 3_000),
    },
    before: {
      entityCount: count,
      dataSourceCount: 1,
      primitiveCount: 1,
      sceneEntityIds,
      visibleOrbitPrimitiveCount: empty ? 0 : selected ? 1 : 2,
      canvasWidth: 960,
      canvasHeight: 640,
      camera: cloneCamera(),
      visualSettings,
      cameraFlight,
      fixtureSource,
    },
    after: {
      entityCount: count,
      dataSourceCount: 1,
      primitiveCount: 1,
      sceneEntityIds,
      visibleOrbitPrimitiveCount: empty ? 0 : selected ? 1 : 2,
      camera: cloneCamera(),
      fixtureEpochMs: 1_000 + (empty ? 10_000 : 3_000),
    },
    visualSettings,
    cameraPose: cloneCamera(),
    renderer: 'fixture-renderer',
    rendererClassification: 'native-metal',
    endpointPngSha256: 'a'.repeat(64),
    endpointPngBytes: 10_000,
    endpointPixels: {
      width: 960,
      height: 640,
      coloredPixels: empty ? 0 : 500,
      rgbaSha256: 'b'.repeat(64),
    },
    cleanup: {
      layerDestroyed: true,
      viewerDestroyed: true,
      remainingLayerEntityCount: 0,
      remainingViewerDestroyed: true,
      governorAfterLayerDestroy: { holds: [], scheduledUpdates: [] },
      governorAfterUninstall: {
        installed: false,
        holds: [],
        scheduledUpdates: [],
      },
    },
    focus: {
      documentVisibleThroughout: true,
      documentFocusedThroughout: true,
      documentFocusedAtStart: true,
      documentFocusedAtEnd: true,
      desktopForegroundVerification: 'unavailable',
    },
  };
}

function validReport() {
  const commit = 'a'.repeat(40);
  return {
    schema: 'gev-mission-render-demand/v1',
    status: 'running',
    source: { commit, inputTreeClean: true },
    applicationCommit: commit,
    harnessCommit: commit,
    buildRecipe: {
      kind: 'vite-development-server',
      config: 'vite.config.js',
      productionBundle: false,
    },
    fixtureIdentity: 'mission-render-demand-two-launches-per-page-epoch/v1',
    trials: scenarios.flatMap((scenario) =>
      variants.map((variant) => makeTrial(scenario, variant, 1)),
    ),
  };
}

test('summarizes complete paired real-viewer fixture observations', () => {
  const summary = validateMissionRenderDemandReport(validReport(), {
    repeats: 1,
  });
  assert.equal(summary.status, 'passed');
  assert.equal(summary.hardwareAcceptance, false);
  assert.equal(summary.byScenario['static-empty'].medianCandidateFrames, 1);
  assert.equal(
    summary.byScenario['unselected-orbit'].medianCandidateMatrixUpdates,
    2,
  );
});

test('camera comparisons allow only the shared pose-roundoff bounds and exclude setup timing', () => {
  const rounded = validReport();
  for (const trial of rounded.trials) {
    const variantOffset =
      trial.variant === 'continuous-control' ? 0.2e-6 : -0.2e-6;
    trial.before.camera.position[0] += variantOffset;
    trial.after.camera.position[0] += variantOffset + 0.2e-6;
    trial.cameraPose = structuredClone(trial.after.camera);
    const orientationOffset =
      trial.variant === 'continuous-control' ? 1e-13 : -1e-13;
    trial.before.camera.direction[1] += orientationOffset;
    trial.after.camera.direction[1] += orientationOffset + 2e-13;
    trial.cameraPose.direction[1] = trial.after.camera.direction[1];
  }
  assert.equal(
    validateMissionRenderDemandReport(rounded, { repeats: 1 }).status,
    'passed',
  );

  const changedPosition = validReport();
  const positionTrial = changedPosition.trials.find(
    (trial) => trial.variant === 'demand-candidate',
  );
  positionTrial.after.camera.position[0] += 2e-6;
  positionTrial.cameraPose.position[0] = positionTrial.after.camera.position[0];
  assert.throws(
    () => validateMissionRenderDemandReport(changedPosition, { repeats: 1 }),
    /Camera pose changed beyond bounded numeric roundoff/,
  );

  const pairedPositionDrift = validReport();
  const pairedTrial = pairedPositionDrift.trials.find(
    (trial) => trial.variant === 'demand-candidate',
  );
  for (const pose of [
    pairedTrial.before.camera,
    pairedTrial.after.camera,
    pairedTrial.cameraPose,
  ])
    pose.position[0] += 2e-6;
  assert.throws(
    () =>
      validateMissionRenderDemandReport(pairedPositionDrift, { repeats: 1 }),
    /Paired fixture before camera changed beyond bounded roundoff/,
  );

  const changedOrientation = validReport();
  const orientationTrial = changedOrientation.trials.find(
    (trial) => trial.variant === 'demand-candidate',
  );
  orientationTrial.after.camera.direction[2] += 2e-12;
  orientationTrial.cameraPose.direction[2] =
    orientationTrial.after.camera.direction[2];
  assert.throws(
    () => validateMissionRenderDemandReport(changedOrientation, { repeats: 1 }),
    /Camera pose changed beyond bounded numeric roundoff/,
  );

  const extraCameraField = validReport();
  extraCameraField.trials[1].cameraPose.transform = Array(16).fill(0);
  assert.throws(
    () => validateMissionRenderDemandReport(extraCameraField, { repeats: 1 }),
    /Camera pose changed beyond bounded numeric roundoff/,
  );

  const differentSetupDurations = validReport();
  assert.notEqual(
    differentSetupDurations.trials[0].cameraFlight.elapsedMs,
    differentSetupDurations.trials[1].cameraFlight.elapsedMs,
  );
  assert.equal(
    validateMissionRenderDemandReport(differentSetupDurations, {
      repeats: 1,
    }).status,
    'passed',
  );
  differentSetupDurations.trials[1].cameraFlight.elapsedMs = 5_001;
  differentSetupDurations.trials[1].before.cameraFlight.elapsedMs = 5_001;
  assert.throws(() =>
    validateMissionRenderDemandReport(differentSetupDurations, {
      repeats: 1,
    }),
  );
});

test('retained failed hosted report passes the corrected offline trial validator', () => {
  const retained = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/performance-evidence/mission-render-demand-38046523488.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(retained.status, 'failed');
  const validationInput = { ...retained, status: 'running' };
  assert.equal(
    validateMissionRenderDemandReport(validationInput, { repeats: 5 }).status,
    'passed',
  );
  assert.equal(retained.status, 'failed');
});

test('rejects missing or duplicate trials instead of filling gaps', () => {
  const report = validReport();
  report.trials.pop();
  assert.throws(() =>
    validateMissionRenderDemandReport(report, { repeats: 1 }),
  );

  const duplicate = validReport();
  duplicate.trials[1] = { ...duplicate.trials[0] };
  assert.throws(() =>
    validateMissionRenderDemandReport(duplicate, { repeats: 1 }),
  );
});

test('requires explicit application, harness, development recipe, and fixture identity', () => {
  for (const mutate of [
    (report) => {
      report.applicationCommit = null;
    },
    (report) => {
      report.harnessCommit = 'b'.repeat(40);
    },
    (report) => {
      report.buildRecipe.productionBundle = true;
    },
    (report) => {
      report.fixtureIdentity = 'unknown';
    },
  ]) {
    const report = validReport();
    mutate(report);
    assert.throws(() =>
      validateMissionRenderDemandReport(report, { repeats: 1 }),
    );
  }
});

test('rejects changed pixels, viewport, and a non-rendered final frame', () => {
  for (const mutate of [
    (report) => {
      report.trials[1].endpointPngSha256 = 'b'.repeat(64);
    },
    (report) => {
      report.trials[1].visualSettings.viewportWidth = 959;
    },
    (report) => {
      report.trials[1].rendering.finalFrameCompletedAfterMeasurement = false;
    },
  ]) {
    const report = validReport();
    mutate(report);
    assert.throws(() =>
      validateMissionRenderDemandReport(report, { repeats: 1 }),
    );
  }
});

test('keeps scene identity and resource populations exact', () => {
  for (const mutate of [
    (trial) => {
      trial.after.sceneEntityIds[0] = 'rocket-launch:unexpected';
    },
    (trial) => {
      trial.after.dataSourceCount += 1;
    },
    (trial) => {
      trial.after.primitiveCount += 1;
    },
  ]) {
    const report = validReport();
    mutate(
      report.trials.find(
        (trial) =>
          trial.scenario === 'unselected-orbit' &&
          trial.variant === 'demand-candidate',
      ),
    );
    assert.throws(() =>
      validateMissionRenderDemandReport(report, { repeats: 1 }),
    );
  }
});

test('requires visible orbit work and retained selected continuous rendering', () => {
  const orbitFailure = validReport();
  orbitFailure.trials.find(
    (trial) =>
      trial.scenario === 'unselected-orbit' &&
      trial.variant === 'demand-candidate',
  ).matrixUpdates.countDuringMeasurement = 0;
  assert.throws(() =>
    validateMissionRenderDemandReport(orbitFailure, { repeats: 1 }),
  );

  const selectedFailure = validReport();
  const selected = selectedFailure.trials.find(
    (trial) =>
      trial.scenario === 'selected-live' &&
      trial.variant === 'demand-candidate',
  );
  selected.rendering.renderModeAtEnd = 'idle';
  assert.throws(() =>
    validateMissionRenderDemandReport(selectedFailure, { repeats: 1 }),
  );

  const staticTrack = validReport();
  const selectedCandidate = staticTrack.trials.find(
    (trial) =>
      trial.scenario === 'selected-live' &&
      trial.variant === 'demand-candidate',
  );
  selectedCandidate.liveTrack.lastPosition = {
    ...selectedCandidate.liveTrack.firstPosition,
  };
  assert.throws(() =>
    validateMissionRenderDemandReport(staticTrack, { repeats: 1 }),
  );
});

test('validates per-run fixture dates against production-normalized launch times', () => {
  const valid = validReport();
  assert.equal(
    validateMissionRenderDemandReport(valid, { repeats: 1 }).status,
    'passed',
  );

  for (const mutate of [
    (source) => {
      source.referenceEpochMs += 1;
    },
    (source) => {
      source.inputLaunchNets[0].net = new Date(0).toISOString();
    },
    (source) => {
      source.effectiveLaunchTimes[1].launchTimeMs += 1;
    },
    (source) => {
      source.nativeSchedulingClockPatched = true;
    },
  ]) {
    const report = validReport();
    mutate(
      report.trials.find((trial) => trial.scenario === 'unselected-orbit')
        .before.fixtureSource,
    );
    assert.throws(() =>
      validateMissionRenderDemandReport(report, { repeats: 1 }),
    );
  }
});
