import { cameraPosesEquivalent } from './routeEquivalence.mjs';

const SCENARIOS = new Set([
  'static-empty',
  'unselected-orbit',
  'selected-live',
]);
const VARIANTS = new Set(['continuous-control', 'demand-candidate']);
const EXPECTED_POPULATIONS = {
  'static-empty': 0,
  'unselected-orbit': 2,
  'selected-live': 2,
};

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function validateFixtureSource(fixtureSource, scenario) {
  requireCondition(
    Number.isSafeInteger(fixtureSource?.referenceEpochMs) &&
      fixtureSource.referenceEpochMs % 1_000 === 0 &&
      fixtureSource.inputsStableAcrossTrials === true &&
      fixtureSource.nativeSchedulingClockPatched === false,
    'Fixture source epoch or clock scope is invalid.',
  );
  const expected =
    scenario === 'static-empty'
      ? []
      : [
          {
            id: 'mission-a',
            net: new Date(
              fixtureSource.referenceEpochMs - 3_600_000,
            ).toISOString(),
            launchTimeMs: fixtureSource.referenceEpochMs - 3_600_000,
          },
          {
            id: 'mission-b',
            net: new Date(
              fixtureSource.referenceEpochMs - 7_200_000,
            ).toISOString(),
            launchTimeMs: fixtureSource.referenceEpochMs - 7_200_000,
          },
        ];
  requireCondition(
    stableJson(fixtureSource.inputLaunchNets) ===
      stableJson(expected.map(({ id, net }) => ({ id, net }))) &&
      stableJson(fixtureSource.effectiveLaunchTimes) ===
        stableJson(
          expected.map(({ id, launchTimeMs }) => ({ id, launchTimeMs })),
        ),
    'Fixture launch timestamps were not accepted unchanged by the production normalizer.',
  );
}

function validateTrial(trial, expected) {
  requireCondition(trial && typeof trial === 'object', 'Trial is missing.');
  requireCondition(trial.status === 'passed', 'A fixture trial failed.');
  requireCondition(SCENARIOS.has(trial.scenario), 'Unknown trial scenario.');
  requireCondition(VARIANTS.has(trial.variant), 'Unknown trial variant.');
  requireCondition(
    trial.scenario === expected.scenario &&
      trial.variant === expected.variant &&
      trial.repeat === expected.repeat,
    'Trial identity does not match its comparison slot.',
  );
  requireCondition(
    Number.isFinite(trial.measurementElapsedMs) &&
      trial.measurementElapsedMs >= trial.durationMs &&
      trial.measurementElapsedMs <= trial.durationMs + 2_000,
    'Measurement window duration is invalid.',
  );
  requireCondition(
    Number.isSafeInteger(trial.rendering?.frameCount) &&
      trial.rendering.frameCount >= 0 &&
      trial.rendering.frameSampleOverflow === false,
    'Rendered-frame sample is invalid or overflowed.',
  );
  requireCondition(
    trial.rendering.finalFrameCompletedAfterMeasurement === true &&
      trial.rendering.finalSettlingFrameExcluded === true,
    'A completed final scene frame was not observed outside measurement.',
  );
  requireCondition(
    trial.cameraFlight?.status === 'completed' &&
      Number.isFinite(trial.cameraFlight.elapsedMs) &&
      trial.cameraFlight.elapsedMs > 0 &&
      trial.cameraFlight.elapsedMs <= 5_000 &&
      trial.before?.cameraFlight?.status === 'completed' &&
      Number.isFinite(trial.before.cameraFlight.elapsedMs) &&
      trial.before.cameraFlight.elapsedMs > 0 &&
      trial.before.cameraFlight.elapsedMs <= 5_000 &&
      trial.before.cameraFlight.elapsedMs === trial.cameraFlight.elapsedMs,
    'The native mission camera flight did not complete within its setup bound.',
  );
  requireCondition(
    trial.before?.entityCount === EXPECTED_POPULATIONS[trial.scenario] &&
      trial.after?.entityCount === EXPECTED_POPULATIONS[trial.scenario] &&
      Number.isSafeInteger(trial.before?.dataSourceCount) &&
      trial.before.dataSourceCount >= 0 &&
      Number.isSafeInteger(trial.after?.dataSourceCount) &&
      trial.after.dataSourceCount >= 0 &&
      Number.isSafeInteger(trial.before?.primitiveCount) &&
      trial.before.primitiveCount >= 0 &&
      Number.isSafeInteger(trial.after?.primitiveCount) &&
      trial.after.primitiveCount >= 0 &&
      trial.before?.dataSourceCount === trial.after?.dataSourceCount &&
      trial.before?.primitiveCount === trial.after?.primitiveCount &&
      trial.before?.visibleOrbitPrimitiveCount ===
        trial.after?.visibleOrbitPrimitiveCount &&
      Array.isArray(trial.before?.sceneEntityIds) &&
      Array.isArray(trial.after?.sceneEntityIds) &&
      stableJson(trial.before.sceneEntityIds) ===
        stableJson(trial.after.sceneEntityIds) &&
      stableJson(trial.before.sceneEntityIds) ===
        stableJson(
          trial.scenario === 'static-empty'
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
              ],
        ),
    'Mission population or scene resources changed during the measurement.',
  );
  requireCondition(
    cameraPosesEquivalent(trial.before.camera, trial.after.camera) &&
      cameraPosesEquivalent(trial.cameraPose, trial.before.camera) &&
      cameraPosesEquivalent(trial.cameraPose, trial.after.camera),
    'Camera pose changed beyond bounded numeric roundoff.',
  );
  requireCondition(
    trial.scenario === 'static-empty'
      ? trial.before.visibleOrbitPrimitiveCount === 0 &&
          trial.after.visibleOrbitPrimitiveCount === 0
      : trial.before.visibleOrbitPrimitiveCount > 0 &&
          trial.after.visibleOrbitPrimitiveCount > 0,
    'Expected visible mission orbit geometry was absent.',
  );
  requireCondition(
    trial.fixtureClock?.startedOnce === true &&
      trial.fixtureClock?.endedClamped === true &&
      trial.fixtureClock?.endEpochMs ===
        trial.fixtureClock.heldEpochMsBeforeMeasurement + trial.durationMs &&
      trial.after?.fixtureEpochMs === trial.fixtureClock.endEpochMs,
    'Fixture time did not follow the declared monotonic interval.',
  );
  validateFixtureSource(trial.before?.fixtureSource, trial.scenario);
  requireCondition(
    trial.before.canvasWidth === 960 &&
      trial.before.canvasHeight === 640 &&
      stableJson(trial.before.visualSettings) ===
        stableJson(trial.visualSettings),
    'Observed pre-measurement settings differ from the trial settings.',
  );
  requireCondition(
    trial.visualSettings?.viewportWidth === 960 &&
      trial.visualSettings?.viewportHeight === 640 &&
      trial.visualSettings?.canvasClientWidth === 960 &&
      trial.visualSettings?.canvasClientHeight === 640 &&
      trial.visualSettings?.canvasWidth === 960 &&
      trial.visualSettings?.canvasHeight === 640 &&
      trial.visualSettings?.viewerResolutionScale === 1 &&
      trial.visualSettings?.msaaSamples === 4 &&
      trial.visualSettings?.maximumRenderTimeChange === 'Infinity' &&
      trial.visualSettings?.imageryLayerCount === 0 &&
      trial.visualSettings?.globe === false &&
      trial.visualSettings?.skyBox === false &&
      trial.visualSettings?.skyAtmosphere === false,
    'Observed viewport or rendering settings differ from the fixture.',
  );
  requireCondition(
    trial.cameraPose &&
      typeof trial.cameraPose === 'object' &&
      trial.renderer?.length > 0 &&
      trial.rendererClassification === 'native-metal' &&
      /^[a-f0-9]{64}$/.test(trial.endpointPngSha256 || '') &&
      Number.isSafeInteger(trial.endpointPngBytes) &&
      trial.endpointPngBytes > 0,
    'Camera, renderer, or endpoint image evidence is missing.',
  );
  requireCondition(
    /^[a-f0-9]{64}$/.test(trial.endpointPixels?.rgbaSha256 || '') &&
      Number.isSafeInteger(trial.endpointPixels?.coloredPixels) &&
      trial.endpointPixels.width === 960 &&
      trial.endpointPixels.height === 640 &&
      (trial.scenario === 'static-empty' ||
        trial.endpointPixels.coloredPixels >= 100),
    'Endpoint frame lacked bounded non-background pixel evidence.',
  );
  requireCondition(
    trial.cleanup?.layerDestroyed === true &&
      trial.cleanup?.viewerDestroyed === true &&
      trial.cleanup?.remainingLayerEntityCount === 0 &&
      trial.cleanup?.remainingViewerDestroyed === true &&
      trial.cleanup?.governorAfterLayerDestroy?.holds?.length === 0 &&
      trial.cleanup?.governorAfterLayerDestroy?.scheduledUpdates?.length ===
        0 &&
      trial.cleanup?.governorAfterUninstall?.installed === false &&
      trial.cleanup?.governorAfterUninstall?.holds?.length === 0 &&
      trial.cleanup?.governorAfterUninstall?.scheduledUpdates?.length === 0,
    'Layer, viewer, or render-demand owner cleanup was not confirmed.',
  );
  if (trial.scenario !== 'static-empty')
    requireCondition(
      trial.endpointPixels.coloredPixels >= 100,
      'Rendered mission geometry was not visible in the endpoint image.',
    );
  requireCondition(
    trial.focus?.documentVisibleThroughout === true &&
      trial.focus?.documentFocusedThroughout === true &&
      trial.focus?.documentFocusedAtStart === true &&
      trial.focus?.documentFocusedAtEnd === true &&
      trial.focus?.desktopForegroundVerification === 'unavailable',
    'Document focus evidence is incomplete or misclassified.',
  );
  if (trial.scenario === 'selected-live') {
    const first = trial.liveTrack?.firstPosition;
    const last = trial.liveTrack?.lastPosition;
    const coordinateValues = [
      first?.longitude,
      first?.latitude,
      first?.altitude,
      last?.longitude,
      last?.latitude,
      last?.altitude,
    ];
    requireCondition(
      trial.liveTrack.sampleCountDuringMeasurement >= 2 &&
        coordinateValues.every(Number.isFinite),
      'Selected mission did not provide repeated live position samples.',
    );
    const longitudeDelta = Math.abs(last.longitude - first.longitude);
    const wrappedLongitudeDelta = Math.min(
      longitudeDelta,
      360 - longitudeDelta,
    );
    requireCondition(
      Math.hypot(wrappedLongitudeDelta, last.latitude - first.latitude) > 0.001,
      'Selected mission position did not move during the measurement.',
    );
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Validate repeated real-viewer trials and summarize observations by workload. */
export function validateMissionRenderDemandReport(
  report,
  { repeats = 5 } = {},
) {
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 5)
    throw new RangeError('Fixture repeat count must be between 1 and 5.');
  requireCondition(
    report?.schema === 'gev-mission-render-demand/v1' &&
      report.status === 'running',
    'Mission render-demand report is not an active fixture report.',
  );
  requireCondition(
    /^[a-f0-9]{40}$/.test(report.applicationCommit || '') &&
      report.applicationCommit === report.harnessCommit &&
      report.source?.commit === report.applicationCommit &&
      report.source?.inputTreeClean === true &&
      report.buildRecipe?.kind === 'vite-development-server' &&
      report.buildRecipe?.config === 'vite.config.js' &&
      report.buildRecipe?.productionBundle === false &&
      report.fixtureIdentity ===
        'mission-render-demand-two-launches-per-page-epoch/v1',
    'Application, harness, fixture, or development-build identity is missing.',
  );
  const expectedCount = SCENARIOS.size * VARIANTS.size * repeats;
  requireCondition(
    Array.isArray(report.trials) && report.trials.length === expectedCount,
    'Mission render-demand report is incomplete.',
  );
  const slots = new Map();
  for (const trial of report.trials) {
    const key = `${trial.scenario}/${trial.repeat}/${trial.variant}`;
    requireCondition(!slots.has(key), 'Duplicate mission fixture trial.');
    slots.set(key, trial);
  }
  const pairs = [];
  for (const scenario of SCENARIOS) {
    const durationMs = scenario === 'static-empty' ? 10_000 : 3_000;
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const control = slots.get(`${scenario}/${repeat}/continuous-control`);
      const candidate = slots.get(`${scenario}/${repeat}/demand-candidate`);
      validateTrial(control, {
        scenario,
        repeat,
        variant: 'continuous-control',
      });
      validateTrial(candidate, {
        scenario,
        repeat,
        variant: 'demand-candidate',
      });
      requireCondition(
        control.durationMs === durationMs &&
          candidate.durationMs === durationMs,
        'Pair measurement durations differ from the declared scenario.',
      );
      const exactSnapshotFields = [
        'entityCount',
        'dataSourceCount',
        'sceneEntityIds',
        'primitiveCount',
        'visibleOrbitPrimitiveCount',
      ];
      for (const phase of ['before', 'after']) {
        for (const key of exactSnapshotFields)
          requireCondition(
            stableJson(control[phase][key]) ===
              stableJson(candidate[phase][key]),
            `Paired fixture ${phase} ${key} changed between variants.`,
          );
        requireCondition(
          cameraPosesEquivalent(control[phase].camera, candidate[phase].camera),
          `Paired fixture ${phase} camera changed beyond bounded roundoff.`,
        );
      }
      requireCondition(
        stableJson(control.before.fixtureSource) ===
          stableJson(candidate.before.fixtureSource) &&
          stableJson(control.visualSettings) ===
            stableJson(candidate.visualSettings) &&
          stableJson(control.before.visualSettings) ===
            stableJson(candidate.before.visualSettings) &&
          control.after.fixtureEpochMs === candidate.after.fixtureEpochMs &&
          control.cameraFlight.status === candidate.cameraFlight.status,
        'Paired fixture identity, settings, or setup state changed between variants.',
      );
      requireCondition(
        cameraPosesEquivalent(control.cameraPose, candidate.cameraPose),
        'Paired camera pose changed beyond bounded numeric roundoff.',
      );
      requireCondition(
        control.endpointPngSha256 === candidate.endpointPngSha256 &&
          control.endpointPixels.rgbaSha256 ===
            candidate.endpointPixels.rgbaSha256,
        'Paired endpoint images differ.',
      );
      requireCondition(
        control.rendering.renderModeAtStart === 'continuous' &&
          candidate.rendering.renderModeAtStart ===
            (scenario === 'selected-live' ? 'continuous' : 'idle'),
        'Render-demand mode does not match the scenario ownership.',
      );
      requireCondition(
        control.rendering.cesiumRequestRenderModeAtStart === false &&
          candidate.rendering.cesiumRequestRenderModeAtStart ===
            (scenario !== 'selected-live'),
        'Cesium request-render mode disagrees with the governor state.',
      );
      if (scenario === 'static-empty') {
        requireCondition(
          control.rendering.frameCount > candidate.rendering.frameCount &&
            candidate.rendering.frameCount <= 2,
          'An empty candidate scene did not remain parked.',
        );
      } else if (scenario === 'unselected-orbit') {
        requireCondition(
          candidate.rendering.frameCount < control.rendering.frameCount &&
            candidate.matrixUpdates.countDuringMeasurement >= 2,
          'Visible unselected orbit cadence or render reduction was not observed.',
        );
      } else {
        requireCondition(
          candidate.rendering.frameCount >= 1 &&
            candidate.rendering.renderModeAtEnd === 'continuous',
          'Selected live mission did not retain continuous rendering.',
        );
      }
      pairs.push({
        scenario,
        repeat,
        controlFrames: control.rendering.frameCount,
        candidateFrames: candidate.rendering.frameCount,
        matrixUpdatesDuringMeasurement:
          candidate.matrixUpdates.countDuringMeasurement,
        endpointPngSha256: candidate.endpointPngSha256,
      });
    }
  }
  return {
    schema: 'gev-mission-render-demand-summary/v1',
    status: 'passed',
    scope:
      'isolated real mission layer on a Cesium viewer; full application UI and world overlays are omitted',
    hardwareAcceptance: false,
    pairs,
    byScenario: Object.fromEntries(
      [...SCENARIOS].map((scenario) => {
        const rows = pairs.filter((pair) => pair.scenario === scenario);
        return [
          scenario,
          {
            medianControlFrames: median(rows.map((row) => row.controlFrames)),
            medianCandidateFrames: median(
              rows.map((row) => row.candidateFrames),
            ),
            medianCandidateMatrixUpdates: median(
              rows.map((row) => row.matrixUpdatesDuringMeasurement),
            ),
          },
        ];
      }),
    ),
  };
}
